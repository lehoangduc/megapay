const crypto = require('crypto');
const cons = require('consolidate');
const _ = require('lodash');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const express = require('express');
const app = express();
const port = 8080;

app.engine('html', cons.swig);
app.set('views', './views');
app.set('view engine', 'html');

app.use(express.json());

// Constants
const DOMAIN = 'https://sandbox.megapay.vn:2810';
const MERCHANT_ID = 'EPAY000001';
const ENCODE_KEY =
  'rf8whwaejNhJiQG2bsFubSzccfRc/iRYyGUn6SPmT6y/L7A2XABbu9y4GvCoSTOTpvJykFi6b1G0crU8et2O0Q==';
const KEY3DES_ENCRYPT = 'pvJykFi6b1G0crU8et2O0Q==';
const KEY3DES_DECRYPT = 'rf8whwaejNhJiQG2bsFubSzc';
const BASE_URL = 'http://localhost:8080';
const NOTIFY_URL = `${BASE_URL}/notify`; // replace with ngrok domain
const CALLBACK_URL = `${BASE_URL}/process`;

const paymentCards = {};

// Helpers
const decrypt = (key, text) => {
  const cipher = crypto.createDecipheriv('des-ede3-ecb', key, null);

  return cipher.update(text, 'hex', 'utf8') + cipher.final('utf8');
};

const encrypt = (key, text) => {
  const cipher = crypto.createCipheriv('des-ede3-ecb', key, null);

  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
};

const validateResponse = (response) => {
  let plainToken;

  if (!response.payOption) {
    plainToken = `${response.resultCd}${response.timeStamp}${response.merTrxId}${response.trxId}${MERCHANT_ID}${response.amount}${ENCODE_KEY}`;
  } else {
    plainToken = `${response.resultCd}${response.timeStamp}${response.merTrxId}${response.trxId}${MERCHANT_ID}${response.amount}${response.payToken}${ENCODE_KEY}`;
  }

  return (
    crypto.createHash('sha256').update(plainToken).digest('hex') ===
    response.merchantToken
  );
};

const getPayOption = (method, isCardSaved, token) => {
  switch (method) {
    case 'atm':
    case 'visa':
      return isCardSaved ? 'PAY_CREATE_TOKEN' : token ? 'PAY_WITH_TOKEN' : '';

    default:
      return '';
  }
};

const saveUserPaymentCards = (userId, cardNo, token) => {
  if (!paymentCards[userId]) paymentCards[userId] = [];

  let card = paymentCards[userId].find((c) => c.card_no === cardNo);
  if (card) {
    card.payment_token = token;
  } else {
    card = {
      card_no: cardNo,
      payment_token: token,
    };

    paymentCards[userId].push(card);
  }

  return card;
};

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/error', (req, res) => {
  res.render('error');
});

app.get('/success', (req, res) => {
  res.render('success');
});

app.get('/users/:userId(\\d+)/cards', (req, res) => {
  res.json({
    data: paymentCards[req.params.userId] || null,
  });
});

app.get('/process', (req, res) => {
  const { resultCd, payOption, userId, cardNo, payToken } = req.query;
  const isValidResponse = validateResponse(req.query);

  // update transaction status + meta

  // update cards
  if (['PAY_CREATE_TOKEN', 'PAY_WITH_TOKEN'].includes(payOption)) {
    saveUserPaymentCards(userId, cardNo, payToken);
  }

  return res.json(req.query);

  if (resultCd !== '00_000' || !isValidResponse)
    return res.redirect(`${BASE_URL}/error`);

  res.redirect(`${BASE_URL}/success`);
});

app.post('/transactions', (req, res) => {
  const { body } = req;
  const { fullname, method, useExistingCard, isCardSaved, cardToken } = body;
  const payOption = getPayOption(
    method,
    isCardSaved,
    useExistingCard ? cardToken : null
  );

  const names = fullname?.trim()?.split(' ') || [''];
  const lastName = names[0];
  const firstName = names.length > 1 ? names[names.length - 1] : '';

  const amount = 150000;
  const timeStamp = dayjs().tz().format('YYYYMMDDHHmmss');
  const merTrxId = 'MERTRXID' + timeStamp + '_' + _.random(100, 10000);
  const invoiceNo = 'Order_' + timeStamp + '_' + _.random(100, 10000);
  const description = 'TT Hoa Don: ' + invoiceNo;

  let plainTxtToken = `${timeStamp}${merTrxId}${MERCHANT_ID}${amount}${ENCODE_KEY}`;
  let encryptedPayToken = '';

  if (payOption === 'PAY_WITH_TOKEN') {
    const clearPayToken = decrypt(KEY3DES_DECRYPT, cardToken);
    encryptedPayToken = encrypt(KEY3DES_ENCRYPT, clearPayToken);

    plainTxtToken = `${timeStamp}${merTrxId}${MERCHANT_ID}${amount}${encryptedPayToken}${ENCODE_KEY}`;
  }

  const merchantToken = crypto
    .createHash('sha256')
    .update(plainTxtToken)
    .digest('hex');

  res.json({
    domain: DOMAIN,
    callBackUrl: CALLBACK_URL,
    notiUrl: NOTIFY_URL,
    merId: MERCHANT_ID,
    userId: 1,
    firstName,
    lastName,
    timeStamp,
    merTrxId,
    amount,
    invoiceNo,
    description,
    merchantToken,
    payOption,
    payToken:
      payOption === 'PAY_WITH_TOKEN' && useExistingCard
        ? encryptedPayToken
        : '',
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Example app listening on port ${port}`);
});
