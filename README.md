# SMTP2MQTT

This project was created to serve as an incoming mailserver for IP security cameras to use.

Most of these cameras can send e-mail when they detect certain events (motion, person, vehicle, etc), and using SMTP2MQTT will allow you to capture these events and publish them over MQTT, to be handled in—for instance—Home Assistant.

Since every brand of camera will send differently worded/layed-out e-mails, you're able to select specific parts of the e-mail (To/From/Subject/Body, etc) and transform them in any way you like.

## MQTT topics

MQTT topics used (assuming the default `smtp2mqtt` prefix):
* `smtp2mqtt/status`: retained message that holds the current online/offline status of SMTP2MQTT
* `smtp2mqtt/sources/$source/events/$event`: published when `$event` occurs on `$source` (see "Field Parser / Special Fields" for more information)
* `smtp2mqtt/sources/$source/fields/$field`: any non-special field and its value are published here

## SECURITY IMPLICATIONS

This isn't a secure SMTP server (in fact, it will allow unauthenticated connections from anyone anywhere) so make sure you only run this in your local network and don't expose it in any way to the outside world.

The sole purpose of this server is to accept e-mail messages, parse them, and publish any parsed fields over MQTT. It will not store and/or deliver the incoming e-mails. All processing is done in-memory.

By default, it will allow messages up to 1K in size, but this is configurable.

It does not allow TLS/SSL/STARTTLS.

## Configuration

See `config.example.yml` for an example configuration file.

## Field Parser

The field parser can be used to extract data from incoming e-mail messages. Fields have a key (name) and a value and are configured in the `config.yml` file, under the `smtp` object.

For example:
```yaml
smtp:
  ...
  fields:
    email_subject: '$.subject'
    email_body: '$.text'
    $source: '$.from.value..name'
    $event:
      query: '$.subject'
      xfrm: 'value.split(" ")[0]?.toLowerCase()'
```

Explanation:
* `email_subject` is the name of a field you want to extract. You're free to pick the names of your fields, but fields whose name starts with `$` are special (see below). Make sure to properly YAML-escape the names if required. It's not recommended to use forward slashes (`/`) in field names.
* `'$.subject'` is a [JSONPath](https://goessner.net/articles/JsonPath/index.html) query. Here, a property by the name of `subject` is extracted from the "root object" (denoted as `$`). Internally, e-mail messages are parsed and converted to a Javascript object. This object is then queried using JSONPath. See below for an example object from a parsed message.
* `$source` and `$event` are special fields (see below).
* Instead of passing a JSONPath query as a string, a field value can also be extracted as a combination of a JSONPath query (`query`) and a Javascript-based transform expression (`xfrm`). In this example, the parser will first extract the value of the e-mail subject, then (using the transform expression) extract the first word from the subject, lowercase it, and assign it to the `$event` field, for example if your camera sends messages with subject like _"Person Detected at 2023/4/5 09:10:11"_ (in which case the extracted value for `$event` will be `person`).

With the above fields, and the example parsed e-mail document below, the following MQTT messages will be published:
```
smtp2mqtt/sources/My Camera/events/person         true
smtp2mqtt/sources/My Camera/fields/email_subject  Person Detected by My Camera at 2023/1/4 09:10:11
smtp2mqtt/sources/My Camera/fields/email_body     A person was detected by camera "My Camera"!
```

### Special fields

Fields whose name starts with `$` are regarded as special, and all _recognized_ special fields serve a specific purpose. Any _unrecognized_ special fields will not be published to MQTT.

Special fields:
* `$source`: this field serves as the "source" value, usually a unique identifier for the camera that sent this e-mail.
* `$event`: this field serves as the "event" value, for instance "motion", "person", etc.

Both fields are not required to be configured, but it's highly recommended to at least configure `$source`. If not, the username that was used to log in on the SMTP server is used. Some cameras only allow e-mail addresses to be configured as usernames, which means that unless you configure an alternative source, messages will be published to `smtp2mqtt/sources/username@example.com/#`, which isn't ideal.

If the `$event` field is not configured, no events will be published to MQTT, only regular fields.

## Parsed message object example

This is one example of a parsed e-mail message (coming from my Reolink camera). Other cameras will send other messages, with different headers/fields/wording/etc.

To see the parsed representation of incoming messages, start `SMTP2MQTT` in debug mode from the command line:
```
$ env DEBUG=smtp2mqtt:parsed node index.js
```

Example:
```
{
  "attachments": [],
  "headers": {
    "from": {
      "value": [
        {
          "address": "mycamera@example.com",
          "name": "My Camera"
        }
      ],
      "html": "<span class=\"mp_address_group\"><a href=\"mailto:mycamera@example.com\" class=\"mp_address_email\">mycamera@example.com</a></span>",
      "text": "mycamera@example.com"
    },
    "to": {
      "value": [
        {
          "address": "homeassistant@example.com",
          "name": "Home Assistant"
        }
      ],
      "html": "<span class=\"mp_address_group\"><a href=\"mailto:homeassistant@example.com\" class=\"mp_address_email\">homeassistant@example.com</a></span>",
      "text": "homeassistant@example.com"
    },
    "subject": "Person Detected by My Camera at 2023/1/4 09:10:11",
    "mime-version": "1.0",
    "content-type": {
      "value": "text/plain",
      "params": {
        "charset": "utf-8"
      }
    },
    "content-transfer-encoding": "base64"
  },
  "headerLines": [
    {
      "key": "from",
      "line": "From: \"My Camera\"<mycamera@example.com>"
    },
    {
      "key": "to",
      "line": "To:<homeassistant@example.com>"
    },
    {
      "key": "subject",
      "line": "Subject:=?UTF-8?B?UGVyc29uIERldGVjdGVkIGJ5IE15IENhbWVyYSBhdCAyMDIzLzEvNCAwOToxMDoxMQ=?="
    },
    {
      "key": "mime-version",
      "line": "Mime-Version:1.0"
    },
    {
      "key": "content-type",
      "line": "Content-Type: text/plain; charset=utf-8"
    },
    {
      "key": "content-transfer-encoding",
      "line": "Content-Transfer-Encoding: base64"
    }
  ],
  "text": "A person was detected by camera \"My Camera\"!",
  "textAsHtml": "<p>A person was detected by camera \"My Camera\"!</p>",
  "subject": "Person Detected by My Camera at 2023/1/4 09:10:11",
  "to": {
    "value": [
      {
        "address": "homeassistant@example",
        "name": "Home Assistant"
      }
    ],
    "html": "<span class=\"mp_address_group\"><a href=\"mailto:homeassistant@example.com\" class=\"mp_address_email\">homeassistant@example.com</a></span>",
    "text": "homeassistant@example.com"
  },
  "from": {
    "value": [
      {
        "address": "mycamera@example.com",
        "name": "My Camera"
      }
    ],
    "html": "<span class=\"mp_address_group\"><a href=\"mailto:mycamera@example.com\" class=\"mp_address_email\">mycamera@example.com</a></span>",
    "text": "mycamera@example.com"
  },
  "html": false
}
```
