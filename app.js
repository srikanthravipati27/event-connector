const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');
const bcrypt = require('bcrypt');
const ejs = require('ejs');
const app = express();
const serviceAccount = require('./sec.json');


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());





app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
const session = require('express-session');

app.use(session({
  secret: 'abc',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));
function convertTimestampToDate(data) {
  if (data.date && data.date.toDate) {
    data.date = data.date.toDate();
  }
  return data;
}


app.use((req, res, next) => {
  req.user = req.session.user || null;
  next();
});

app.use((req, res, next) => {
  console.log('Session data:', req.session);
  console.log('User data:', req.user);
  next();
});


app.get('/', (req, res) => res.render('index'));


app.get('/login', (req, res) => res.render('login'));
app.get('/student-login', (req, res) => res.render('student-login'));
app.get('/college-login', (req, res) => res.render('college-login'));

app.get('/college-signup', (req, res) => res.render('college-signup'));
app.get('/student-signup', (req, res) => res.render('student-signup'));
app.get('/signup', (req, res) => res.render('signup'));


app.get('/college-profile', async (req, res) => {
  if (!req.session.user || req.session.user.type !== 'college') {
    return res.redirect('/login'); 
  }

  const collegeId = req.session.user.id; 

  try {
    const collegeSnapshot = await db.collection('colleges').doc(collegeId).get();
    const college = collegeSnapshot.data();

    res.render('college-profile', { college });
  } catch (error) {
    console.error('Error fetching college profile:', error);
    res.status(500).json({ error: 'An error occurred while fetching the college profile.' });
  }
});



app.get('/colleges', async (req, res) => {
  try {
    const collegesSnapshot = await db.collection('colleges').get();
    const colleges = collegesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('colleges', { colleges });
  } catch (error) {
    console.error('Error fetching colleges:', error);
    res.status(500).json({ error: 'An error occurred while fetching colleges.' });
  }
});


app.get('/colleges/:id', async (req, res) => {
  const collegeId = req.params.id;
  try {
    
    const college = await db.collection('colleges').doc(collegeId).get();
    const eventsSnapshot = await db.collection('events').where('collegeId', '==', collegeId).get();

    if (!college.exists) {
      return res.status(404).send('College not found');
    }

    
    const events = await Promise.all(eventsSnapshot.docs.map(async (doc) => {
      const eventData = doc.data();
      const registeredUsersData = [];

      if (eventData.registeredUsers && eventData.registeredUsers.length > 0) {
        const usersSnapshot = await db.collection('students').where(admin.firestore.FieldPath.documentId(), 'in', eventData.registeredUsers).get();
        registeredUsersData.push(...usersSnapshot.docs.map(userDoc => userDoc.data()));
      }

      return {
        ...eventData,
        registeredUsersData,
      };
    }));

    res.render('college-eventdis', {
      college: college.data(),
      events: events
    });
  } catch (error) {
    console.error('Error fetching college events:', error);
    res.status(500).send('Server error');
  }
});




app.get('/events', async (req, res) => {
  try {
    const eventsSnapshot = await db.collection('events').get();
    const events = eventsSnapshot.docs.map(doc => convertTimestampToDate({ id: doc.id, ...doc.data() }));
    res.render('events', { events, user: req.user });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'An error occurred while fetching events.' });
  }
});

app.post('/api/events/register', async (req, res) => {
  const { eventId, userId } = req.body; 
  console.log(req.body);
  try {
    const eventRef = db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();
    
    if (eventDoc.exists) {
      const eventData = eventDoc.data();
      
      
      const registeredUsers = eventData.registeredUsers || [];
      
     
      if (!registeredUsers.includes(userId)) {
        
        await eventRef.update({
          registeredUsers: admin.firestore.FieldValue.arrayUnion(userId)
        });

        
        const studentRef = db.collection('students').doc(userId);
        await studentRef.update({
          registeredEvents: admin.firestore.FieldValue.arrayUnion(eventId)
        });

        res.redirect('/events');
      } else {
        res.send('Already registered.');
      }
    } else {
      res.status(404).send('Event not found.');
    }
  } catch (error) {
    console.error('Error registering for event:', error);
    res.status(500).send('Internal Server Error');
  }
});




app.get('/upcoming-events', async (req, res) => {
  try {
    const upcomingEventsSnapshot = await db.collection('events')
      .where('registeredUsers', 'array-contains', req.user.id)
      .where('date', '>=', new Date())
      .orderBy('date')
      .get();
    const upcomingEvents = upcomingEventsSnapshot.docs.map(doc => convertTimestampToDate({ id: doc.id, ...doc.data() }));
    res.render('upcoming-events', { upcomingEvents });
  } catch (error) {
    console.error('Error fetching upcoming events:', error);
    res.status(500).json({ error: 'An error occurred while fetching upcoming events.' });
  }
});


app.get('/event-history', async (req, res) => {
  try {
    const historyEventsSnapshot = await db.collection('events')
      .where('registeredUsers', 'array-contains', req.user.id)
      .where('date', '<', new Date())
      .orderBy('date', 'desc')
      .get();
    const historyEvents = historyEventsSnapshot.docs.map(doc => convertTimestampToDate({ id: doc.id, ...doc.data() }));
    res.render('event-history', { historyEvents });
  } catch (error) {
    console.error('Error fetching event history:', error);
    res.status(500).json({ error: 'An error occurred while fetching event history.' });
  }
});


app.get('/signout', (req, res) => {
  req.user = null; 
  res.redirect('/');
});


app.get('/contact', (req, res) => res.render('contact'));


app.post('/student-signup', async (req, res) => {
  const { email, password, name } = req.body;

  try {
    const existingUserSnapshot = await db.collection('students').where('email', '==', email).get();

    if (!existingUserSnapshot.empty) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userRef = db.collection('students').doc();
    await userRef.set({ email, password: hashedPassword, name });

    res.status(200).json({ message: 'Sign up successful!' });
  } catch (error) {
    console.error('Error during student signup:', error);
    res.status(500).json({ error: 'An error occurred during signup' });
  }
});

app.post('/student-login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const snapshot = await db.collection('students').where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const student = snapshot.docs[0].data();
    const isMatch = await bcrypt.compare(password, student.password);

    if (isMatch) {
      req.session.user = { id: snapshot.docs[0].id, type: 'student' };
      console.log('Login successful:', req.session.user); 
      return res.status(200).json({ message: 'Login successful' });
    } else {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Error during college login:', error);
    return res.status(500).json({ error: 'An error occurred during login' });
  }
});

app.get('/student-dashboard', async (req, res) => {
 
  if (!req.user || req.user.type !== 'student') {
    console.error('Unauthorized access: req.user is not set or not a student', req.user);
    return res.redirect('/login'); 
  }

  try {
    const studentId = req.user.id; 

    
    let latestEvents = [];
    try {
      const latestEventsSnapshot = await db.collection('events')
        .orderBy('date', 'desc')
        .limit(3)
        .get();
      latestEvents = latestEventsSnapshot.docs.map(doc => convertTimestampToDate({
        id: doc.id,
        ...doc.data() 
      }));
    } catch (error) {
      console.error('Error fetching latest events:', error);
      throw new Error('Failed to fetch latest events');
    }

  
    let upcomingEvents = [];
    try {
      const registeredEventsSnapshot = await db.collection('events')
        .where('registeredUsers', 'array-contains', studentId)
        .where('date', '>=', new Date())
        .orderBy('date')
        .get();
      upcomingEvents = registeredEventsSnapshot.docs.map(doc => convertTimestampToDate({
        id: doc.id,
        ...doc.data() 
      }));
    } catch (error) {
      console.error('Error fetching upcoming events:', error);
      throw new Error('Failed to fetch upcoming events');
    }

    
    let historyEvents = [];
    try {
      const historyEventsSnapshot = await db.collection('events')
        .where('registeredUsers', 'array-contains', studentId)
        .where('date', '<', new Date())
        .orderBy('date', 'desc')
        .get();
      historyEvents = historyEventsSnapshot.docs.map(doc => convertTimestampToDate({
        id: doc.id,
        ...doc.data() 
      }));
    } catch (error) {
      console.error('Error fetching event history:', error);
      throw new Error('Failed to fetch event history');
    }

    
    let colleges = [];
    try {
      const collegesSnapshot = await db.collection('colleges').get();
      colleges = collegesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('Error fetching colleges:', error);
      throw new Error('Failed to fetch colleges');
    }

    const success = req.query.success === 'true'; 

    
    res.render('student-dashboard', {
      latestEvents,
      upcomingEvents,
      historyEvents,
      colleges,
      query: req.query,
      success, 
      user: req.user 
    });
  } catch (error) {
    console.error('Error loading student dashboard:', error);
    res.status(500).send('Error loading student dashboard.');
  }
});


app.post('/college-signup', async (req, res) => {
  const { email, password, collegeName } = req.body;

  try {
    const existingCollegeSnapshot = await db.collection('colleges').where('email', '==', email).get();

    if (!existingCollegeSnapshot.empty) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const collegeRef = db.collection('colleges').doc();
    await collegeRef.set({ email, password: hashedPassword, collegeName });

    res.status(200).json({ message: 'Sign up successful!' });
  } catch (error) {
    console.error('Error during college signup:', error);
    res.status(500).json({ error: 'An error occurred during signup' });
  }
});



app.post('/college-login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const snapshot = await db.collection('colleges').where('email', '==', email).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const college = snapshot.docs[0].data();
    const isMatch = await bcrypt.compare(password, college.password);

    if (isMatch) {
      req.session.user = { id: snapshot.docs[0].id, type: 'college' };
      return res.status(200).json({ message: 'Login successful' });
    } else {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Error during college login:', error);
    return res.status(500).json({ error: 'An error occurred during login' });
  }
});



app.get('/college-dashboard', async (req, res) => {
  if (!req.session.user || req.session.user.type !== 'college') {
    return res.status(401).json({ error: 'Unauthorized access' });
  }

  const collegeId = req.session.user.id; 

  try {
    
    const collegeEventsSnapshot = await db.collection('events')
      .where('collegeId', '==', collegeId)
      .get();
    const collegeEvents = collegeEventsSnapshot.docs.map(doc => convertTimestampToDate({
      id: doc.id,
      ...doc.data()
    }));

    
    const upcomingEventsSnapshot = await db.collection('events')
      .where('collegeId', '==', collegeId)
      .where('date', '>=', new Date())
      .orderBy('date')
      .get();
    const upcomingEvents = upcomingEventsSnapshot.docs.map(doc => convertTimestampToDate({
      id: doc.id,
      ...doc.data()
    }));

    
    const historyEventsSnapshot = await db.collection('events')
      .where('collegeId', '==', collegeId)
      .where('date', '<', new Date())
      .orderBy('date', 'desc')
      .get();
    const historyEvents = historyEventsSnapshot.docs.map(doc => convertTimestampToDate({
      id: doc.id,
      ...doc.data()
    }));

   
    const collegeSnapshot = await db.collection('colleges').doc(collegeId).get();
    const college = collegeSnapshot.data();

    res.render('college-dashboard', {
      college,
      collegeEvents,
      upcomingEvents,
      historyEvents,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading college dashboard:', error);
    res.status(500).json({ error: 'An error occurred while loading the dashboard.' });
  }
});


app.post('/api/events', async (req, res) => {
  const { name, description, date, location, collegeId } = req.body;
  try {
    await db.collection('events').add({
      name,
      description,
      date: new Date(date), 
      location,
      collegeId,
      registeredUsers: []
    });
    res.redirect('/college-dashboard');
  } catch (error) {
    console.error('Error posting event:', error);
    res.status(500).json({ error: 'An error occurred while posting the event.' });
  }
});



app.get('/post-event', (req, res) => {
  if (req.user.type === 'college') {
    res.render('post-event');
  } else {
    res.redirect('/'); 
  }
});
app.get('/college-eventdis', (req, res) => {
  res.render('college-eventdis');
});


app.post('/post-event', async (req, res) => {
  const { name, type, subject, location, eligibility,registrationfee,prizes,eventdate,description } = req.body;
  try {
    if (req.user.type !== 'college') {
      return res.redirect('/'); 
    }

    await db.collection('events').add({
      name,
      type,
      subject,
      location,
      eligibility,
      registrationfee,
      prizes,
      date: new Date(eventdate),
      description,
      collegeId: req.user.id,
      registeredUsers: []

      
    });

    res.redirect('/college-dashboard?success=true');
  } catch (error) {
    console.error('Error posting event:', error);
    res.status(500).json({ error: 'An error occurred while posting the event.' });
  }
});


app.get('/college-history', async (req, res) => {
  try {
    const collegeId = req.user.id;
    const historyEventsSnapshot = await db.collection('events')
      .where('collegeId', '==', collegeId)
      .where('date', '<', new Date())
      .orderBy('date', 'desc')
      .get();
    const historyEvents = historyEventsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      date: doc.data().date.toDate()
    }));
    res.render('college-history', { historyEvents });
  } catch (error) {
    console.error('Error fetching college history:', error);
    res.status(500).json({ error: 'An error occurred while fetching college history.' });
  }
});
app.get('/college-events', async (req, res) => {
  console.log(req.session.user.id);
  
  const collegeId = req.session.user.id;

  try {
    
    const collegeSnapshot = await db.collection('colleges').doc(collegeId).get();
    if (!collegeSnapshot.exists) {
      return res.status(404).send('College not found');
    }

    
    const eventsSnapshot = await db.collection('events')
      .where('collegeId', '==', collegeId)
      .get();

    const events = await Promise.all(eventsSnapshot.docs.map(async (doc) => {
      const eventData = doc.data();
      const registeredUsersData = [];

      
      if (eventData.registeredUsers && eventData.registeredUsers.length > 0) {
        const usersSnapshot = await db.collection('students')
          .where(admin.firestore.FieldPath.documentId(), 'in', eventData.registeredUsers)
          .get();
        registeredUsersData.push(...usersSnapshot.docs.map(userDoc => userDoc.data()));
      }

      return convertTimestampToDate({
        id: doc.id,
        ...eventData,
        registeredUsersData
      });
    }));

    res.render('college-events', {
      college: collegeSnapshot.data(),
      events
    });
  } catch (error) {
    console.error('Error fetching college events:', error);
    res.status(500).send('Server error');
  }
});



app.get('/college-upcoming-events', async (req, res) => {
  try {
    const collegeId = req.user.id;
    const upcomingEventsSnapshot = await db.collection('events')
      .where('collegeId', '==', collegeId)
      .where('date', '>=', new Date())
      .orderBy('date')
      .get();
      const upcomingEvents = upcomingEventsSnapshot.docs.map(doc => convertTimestampToDate({
        id: doc.id,
        ...doc.data()
      }));
      
    res.render('college-upcoming-event', { upcomingEvents });
  } catch (error) {
    console.error('Error fetching college upcoming events:', error);
    res.status(500).json({ error: 'An error occurred while fetching upcoming events.' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
