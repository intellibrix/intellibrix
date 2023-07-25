let setup
try {
  setup = require('./env.js')
} catch (err) {}

if (setup) setup()
