const fs                   = require('node:fs/promises');
const vm                   = require('node:vm');
const { join }             = require('node:path');
const { parse : urlParse } = require('node:url');
const MQTT                 = require('async-mqtt');
const jsonpath             = require('jsonpath');
const YAML                 = require('yaml');
const SMTPServer           = require('smtp-server').SMTPServer;
const simpleParser         = require('mailparser').simpleParser;
const debug                = require('debug')('smtp2mqtt');
const debugParsed          = require('debug')('smtp2mqtt:parsed');

void async function() {
  // read config file
  const config = YAML.parse( await fs.readFile(join(__dirname, 'config.yml'), 'utf-8') );

  // quick-validate configuration
  if (! config.mqtt) throw Error('[config.yml] missing `mqtt` configuration');
  if (! config.smtp) throw Error('[config.yml] missing `smtp` configuration');

  // if MQTT config is a string, parse it
  if (typeof config.mqtt === 'string') {
    config.mqtt = urlParse(config.mqtt);
    config.mqtt.base_topic = config.mqtt.pathname?.substring(1);
    if (config.mqtt.auth) {
      config.mqtt.username = config.mqtt.auth.split(':')[0];
      config.mqtt.password = config.mqtt.auth.split(':')[1];
    }
  }

  // connect to MQTT server
  const baseTopic = config.mqtt.base_topic || 'smtp2mqtt';
  const mqtt      = await MQTT.connectAsync({
    ...config.mqtt,
    will : {
      topic:   join(baseTopic, 'status'),
      payload: 'offline',
      retain:  true
    }
  });
  debug(`connected to MQTT server`);

  // set connection state to LWT topic
  await mqtt.publish(join(baseTopic, 'status'), 'online');

  // Start SMTP server
  new SMTPServer({
    name:              config.smtp.name ?? 'SMTP2MQTT',
    size:              config.smtp.size ?? 1024,
    allowInsecureAuth: true,
    disabledCommands:  [ 'STARTTLS' ],
    onConnect(session, callback) {
      debug(`onConnect — address=${ session.remoteAddress } session=${ session.id }`);
      return callback();
    },
    onAuth(auth, session, callback) {
      debug(`onAuth — username=${ auth.username } session=${ session.id }`);
      return callback(null, { user : auth.username });
    },
    async onData(stream, session, callback) {
      debug(`onData — username=${ session.user } session=${ session.id }`);
      if (! config.smtp.fields) {
        // nothing to do
        debug(`onData — nothing to do`);
        return;
      }
      try {
        const parsed = await simpleParser(stream);

        // convert Map to Object for jsonpath
        parsed.headers = Object.fromEntries(parsed.headers)

        // output parsed message as JSON for debugging
        debugParsed('%j', parsed);

        // process fields
        const fields = Object.entries(config.smtp.fields || {}).reduce((acc, [ fieldName, fieldValue ]) => {
          let value;
          if (typeof fieldValue === 'object') {
            if (fieldValue.query) {
              value = jsonpath.query(parsed, fieldValue.query);
            }
            if (fieldValue.xfrm) {
              const ctx = { message : parsed, value : fieldValue.value == true ? JSON.stringify(value) : String(value) };
              try {
                value = vm.runInNewContext(fieldValue.xfrm, ctx);
              } catch(e) {
                console.error(e);
                value = ctx.value;
              }
            }
          } else {
            value = jsonpath.query(parsed, fieldValue);
          }
          acc[fieldName] = fieldValue.json == true ? JSON.stringify(Array.isArray(value) && value.length === 1 ? value[0] : value) : String(value);
          return acc;
        }, {});

        // Publish MQTT messages
        const prefix = join(baseTopic, 'sources', fields.$source ?? session.user);
        if (fields.$event) {
          mqtt.publish(join(prefix, 'events', fields.$event), 'true');
        }
        for (const [ field, value ] of Object.entries(fields)) {
          if (field[0] === '$' || value === undefined) continue;
          mqtt.publish(join(prefix, 'fields', field), value);
        }
      } catch(e) {
        console.error('Error parsing incoming e-mail');
        console.error(e);
      }
      return callback();
    }
  }).listen(config.smtp.port || 2525, '0.0.0.0');
}();
