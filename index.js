const express = require('express');
const app = express()
const server = require('http').Server(app);
const path = require('path');
const cors = require('cors');
const io = require('socket.io')(server);
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;
const bodyParser = require('body-parser')

// api config
app.use(cors())
app.use(bodyParser.json({ type: 'application/json' }));

// active accounts schema
const activeAccountsSchema = new mongoose.Schema({
  socket_id: { type: String, required: true },
  connected_at: { type: Date, required: true },
  ida_window_id: { type: String },
  client: { type: String },
  data: { type: Object }
}, {
  usePushEach: true,
  timestamps: { updatedAt: 'updated_at', createdAt: 'created_at' },
});

// accounts history schema
const accountsHistorySchema = new mongoose.Schema({
  socket_id: { type: String, required: true },
  connected_at: { type: Date, required: true },
  ida_window_id: { type: String },
  data: { type: Object }
}, {
  usePushEach: true,
  timestamps: { updatedAt: 'updated_at', createdAt: 'created_at' },
});


/**
  * mongodb - function that add connect with mongodb returns an conection.
  *
  * @function mongodb
  * @param {object} data
  * @param {object} data.mongoUrl uri to db
  */
const mongodb = async function ({
  mongoUrl = process.env.MONGO_URL || 'mongodb+srv://som:ZyzdIdWWHvZIjmJB@cluster0-qqrtz.mongodb.net/auth?retryWrites=true&w=majority',
}) {
  console.log('mongoUrl: ', mongoUrl);
  try {
    console.log('=> using new database connection');

    const newConnection = await mongoose.createConnection(mongoUrl, {
      bufferCommands: false,
      bufferMaxEntries: 0,
      keepAlive: true,
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });

    newConnection.model('active-accounts', activeAccountsSchema);
    newConnection.model('accounts-log', accountsHistorySchema);
    return newConnection;
  } catch (err) {
    console.log('error: ', [err]);
    throw err;
  }
};

/**
  * setIdaWindowId - function that list.
  *
  * @function setIdaWindowId
  * @param {object} payload
  * @param {object} payload.client_type uri to db
  * @param {object} payload.client_id if the client have 'ida' value, you must sent the client socket id
  * @param {MongoDb} db db connection
  */
const setIdaWindowId = async (payload, db, socket) => {
console.log('payload', payload);
  if (!payload.client_id ) {
    throw new Error(`validation/ Missing [client_id] param`)
  }
  try {
    const account = await db.model('active-accounts')
      .findOneAndUpdate(
        { socket_id: payload.client_id },
        {  ida_window_id: socket.id },
        { new: true },
      );

      
    console.log('setIdaWindowId -> account', account);
    return account;
  } catch (err) {
    throw (err)
  }
}

/**
  * onConnect - function that create connections in our db.
  *
  * @function onConnect
  * @param {object} payload
  * @param {object} payload.client_type uri to db
  * @param {object} payload.client_id if the client have 'ida' value, you must sent the client socket id
  * @param {Scoket} socket client socket class
  * @param {Scoket} io io socket class
  * @param {MongoDb} db db connection
  */
const onConnect = async (payload, socket, io, db) => {
console.log('onConnect');
  if (!payload.client_type) {
    socket.emit('error-listenner', {
      msg: 'connect event error, missing [client] param',
      type: 'validation',
    });
    return;
  }

  if (payload.client_type === 'ida') {
    console.log('payload.client_type === ida', payload.client_type === 'ida');
    try {
      await setIdaWindowId({
        client_id: payload.client_id,
      }, db, socket);
      io.to(payload.client_id).emit('opened', { ida_window_id: socket.id })
    } catch (err) {
      let msg = err.message;
      let type = 'db_connection';
      if (msg.split('/')[0] === 'validation'){
        msg = msg.split('/')[1];
        type = msg.split('/')[0]
      }
      socket.emit('error_listenner', { msg, type });
      return;
    }
  } else {
    const createdAccount = await db.model('active-accounts')
      .create({
        socket_id: socket.id,
        connected_at: new Date(),
        client: payload.client_type,
      });
    console.log('createdAccount', createdAccount);
  }
}


/**
  * onUpdateAuth - function that create connections in our db.
  *
  * @function onUpdateAuth
  * @param {object} payload
  * @param {object} payload.user updated user
  * @param {object} payload.client_id if the client have 'ida' value, you must sent the client socket id
  * @param {Scoket} socket client socket class
  * @param {Scoket} io io socket class
  * @param {MongoDb} db db connection
  */
const onUpdateAuth = async (payload, socket, io, db) => {
console.log('payload', payload);
console.log('--------------onUpdateAuth');
  if (!payload.client_id) {
    socket.emit('error-listenner', {
      msg: 'connect event error, missing [client_id] param',
      type: 'validation',
    });
    return;
  }
  try {
    const account = await db.model('active-accounts')
      .findOneAndUpdate(
        { socket_id: payload.client_id },
        {  data: payload.user },
        { new: true },
      );
    console.log('onUpdateAuth -> account', account);
  } catch (err) {
    socket.emit('error-listenner', {
      msg: 'error to update account',
      type: 'db',
    });
  }
  io.to(payload.client_id).emit('auth_change', payload.user);
}
const db = mongodb({}).then(resp => resp);

io.on('connection', async (socket) => {
  console.log(' => connect', socket.id);
  socket.on("init", (payload) => onConnect(payload, socket, io, db));
  socket.on("update_auth", (payload) => onUpdateAuth(payload, socket, io, db));

  
  socket.on('disconnect', async () => {
    const account = await db.model('active-accounts')
      .deleteOne(
        { $or: [{ socket_id: socket.id }, { ida_window_id:  socket.id  }] },
        { new: true },
        );
    console.log('disconnect - account', account);
  });
});


server.listen(process.env.PORT || 8080);
