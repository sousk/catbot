// Copyright 2015-2016, Google, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// [START app]

var request = require('request');
var express = require('express');

var app = express();

app.get('/', function(req, res) {
  console.log(req.query);
  res.status(200).send("hello");
});

// Start the server
var server = app.listen(process.env.PORT || '8080', '0.0.0.0', function() {
  console.log('App listening at http://%s:%s', server.address().address,
    server.address().port);
  console.log('Press Ctrl+C to quit.');
});

var config = require('config');
var Botkit = require('botkit');

var controller = Botkit.slackbot({
    // debug: true,
});

controller.spawn({
  token: config.get('slack.token')
}).startRTM();

controller.hears(
  ['.* cat .*', 'cat .*', '.* cat'],
  'direct_message,direct_mention,mention',
  function(bot, message) {
    request("http://thecatapi.com/api/images/get?type=gif&format=xml", function(err, res, body) {
      if (err) {
        console.log("ERR", err);
        return;
      }
      var matched = body.match(/<url>([^<]+)<\/url>/);
      if (!(matched && matched[1])) {
        console.log("no matches:", body);
        return;
      }
      bot.reply(message, matched[1]);
    });
  });

controller.hears(['hello', 'hi'],
  'direct_message,direct_mention,mention', function(bot, message) {
    bot.api.reactions.add({
      timestamp: message.ts,
      channel: message.channel,
      name: 'robot_face'
    }, function(err, res) {
      if (err) {
        bot.botkit.log('Failed to add emoji reaction :(', err, res);
      }
    });
    controller.storage.users.get(message.user, function(err, user) {
      if (err) {
        console.log(err);
      }
      if (user && user.name) {
        bot.reply(message, 'Hello ' + user.name + '!!');
      } else {
        bot.reply(message, 'Hello.');
      }
    });
  });

controller.hears(['shutdown'],
  'direct_message,direct_mention,mention', function(bot, message) {
    bot.startConversation(message, function(err, convo) {
      if (err) {
        console.log(err);
      }
      convo.ask('Are you sure you want me to shutdown?', [{
        pattern: bot.utterances.yes,
        callback: function(response, convo) {
          convo.say('Bye!');
          convo.next();
          setTimeout(function() {
            process.exit();
          }, 3000);
        }
      },
      {
        pattern: bot.utterances.no,
        default: true,
        callback: function(response, convo) {
          convo.say('*Phew!*');
          convo.next();
        }
      }]);
    });
  });

// [END app]
