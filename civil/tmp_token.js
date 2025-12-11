const jwt = require('jsonwebtoken');
const token = jwt.sign({ id: 'c890f19d-261b-4120-85b9-8be4b990d98d' }, 'dev_secret');
console.log(token);
