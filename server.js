const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: 'https://client-3ke0ngmxp-kouji-s-projects-352e3ffd.vercel.app',
    methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());
app.use('/images', express.static('images'));

const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// メール送信設定の確認
transporter.verify((error, success) => {
  if (error) {
    console.error('Nodemailer configuration error:', error);
  } else {
    console.log('Nodemailer is ready to send emails');
  }
});

let db;
async function connectToDB() {
  const uri = process.env.MONGODB_URI;
  console.log('MONGODB_URI:', uri);
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db();
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await db.collection('rooms').find().toArray();
    res.json(rooms);
  } catch (err) {
    console.error('Error fetching rooms:', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

connectToDB().then(() => {
  // 環境変数をログに出力
  console.log('Environment Variables:', {
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    VITE_API_URL: process.env.VITE_API_URL,
  });

  app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Aizu Inn Server!' });
  });

  app.post(
    '/api/reservations',
    [
      body('userId').optional().isString().withMessage('ユーザーIDは文字列で入力してください'),
      body('name').isString().withMessage('名前は文字列で入力してください').trim().isLength({ min: 2, max: 50 }).withMessage('名前は2～50文字で入力してください').notEmpty().withMessage('名前は必須です'),
      body('email').isEmail().withMessage('有効なメールアドレスを入力してください').notEmpty().withMessage('メールアドレスは必須です'),
      body('postalCode').matches(/^\d{3}-\d{4}$/).withMessage('郵便番号は「123-4567」の形式で入力してください').notEmpty().withMessage('郵便番号は必須です'),
      body('address').isString().withMessage('住所は文字列で入力してください').trim().isLength({ min: 5, max: 100 }).withMessage('住所は5～100文字で入力してください').notEmpty().withMessage('住所は必須です'),
      body('phone').matches(/^\d{10,11}$/).withMessage('電話番号は10～11桁の数字で入力してください').notEmpty().withMessage('電話番号は必須です'),
      body('roomType').isString().withMessage('部屋タイプは文字列で入力してください').notEmpty().withMessage('部屋タイプは必須です'),
      body('checkIn').isISO8601().withMessage('チェックインは有効な日付（YYYY-MM-DD）を入力してください').notEmpty().withMessage('チェックインは必須です'),
      body('checkOut').isISO8601().withMessage('チェックアウトは有効な日付（YYYY-MM-DD）を入力してください').notEmpty().withMessage('チェックアウトは必須です').custom((value, { req }) => {
        const checkInDate = new Date(req.body.checkIn);
        const checkOutDate = new Date(value);
        if (checkOutDate <= checkInDate) {
          throw new Error('チェックアウトはチェックインより後の日付にしてください');
        }
        return true;
      }),
      body('nights').isInt({ min: 1 }).withMessage('泊数は1以上の整数で入力してください').notEmpty().withMessage('泊数は必須です'),
      body('guests').isInt({ min: 1 }).withMessage('人数は1以上の整数で入力してください').notEmpty().withMessage('人数は必須です'),
      body('roomId').isMongoId().withMessage('部屋IDは有効なMongoDB ObjectId形式で入力してください').notEmpty().withMessage('部屋IDは必須です'),
    ],
    async (req, res) => {
      console.log('Received POST /api/reservations:', JSON.stringify(req.body, null, 2));
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('Validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
      }

      try {
        const { userId, name, email, postalCode, address, phone, roomType, checkIn, checkOut, nights, guests, roomId } = req.body;

        console.log('Checking roomId:', roomId);
        const room = await db.collection('rooms').findOne({ _id: new ObjectId(roomId) });
        if (!room) {
          console.log('Room not found for roomId:', roomId);
          return res.status(400).json({ errors: [{ msg: '指定された部屋IDは存在しません' }] });
        }

        const reservation = {
          userId: userId || 'guest',
          name,
          email,
          postalCode,
          address,
          phone,
          roomId: new ObjectId(roomId),
          roomType,
          checkIn: new Date(checkIn),
          checkOut: new Date(checkOut),
          nights,
          guests,
          status: 'confirmed',
          createdAt: new Date(),
          roomDetails: {
            price: room.price,
            image: room.image,
            name: room.name,
          },
        };

        const result = await db.collection('reservations').insertOne(reservation);
        const insertedReservation = { id: result.insertedId, ...reservation };

        console.log('Sending email to:', email);
        try {
          const totalPrice = reservation.roomDetails.price * reservation.nights * reservation.guests;
          const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'ご予約ありがとうございます！',
            text: `
              ${reservation.name} 様

              以下の内容でご予約を承りました。

              お客様情報:
              - 名前: ${reservation.name}
              - メール: ${reservation.email}
              - 電話番号: ${reservation.phone}
              - 住所: ${reservation.address}
              - 郵便番号: ${reservation.postalCode}

              予約内容:
              - 部屋タイプ: ${reservation.roomType}
              - チェックイン: ${new Date(reservation.checkIn).toLocaleDateString('ja-JP')}
              - チェックアウト: ${new Date(reservation.checkOut).toLocaleDateString('ja-JP')}
              - 宿泊数: ${reservation.nights}泊
              - 宿泊人数: ${reservation.guests}名
              - 合計金額: ¥${totalPrice.toLocaleString()}

              予約番号: ${result.insertedId}

              ご不明点があれば、いつでもご連絡ください。
            `,
          };
          console.log('Mail options:', mailOptions);
          await transporter.sendMail(mailOptions);
          console.log('Email sent to:', email);
        } catch (emailErr) {
          console.error('Error sending email:', emailErr.message, emailErr.stack);
        }

        console.log('Reservation created:', insertedReservation);
        res.status(201).json(insertedReservation);
      } catch (err) {
        console.error('Error creating reservation:', err);
        res.status(500).json({ error: `Failed to create reservation: ${err.message}` });
      }
    }
  );

  app.get('/api/reservations/:id', async (req, res) => {
    try {
      const reservation = await db.collection('reservations').findOne({ _id: new ObjectId(req.params.id) });
      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found' });
      }
      const room = await db.collection('rooms').findOne({ _id: reservation.roomId });
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      res.json({ ...reservation, roomDetails: room });
    } catch (err) {
      console.error('Error fetching reservation:', err);
      res.status(500).json({ error: 'Failed to fetch reservation' });
    }
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
});