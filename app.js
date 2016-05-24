// TBD: try
// https://github.com/Microsoft/BotBuilder/tree/master/Node
//
// [START app]

var request = require('request');
var express = require('express');

var debug = true;
var app = express();

var commands = [
  // func, matecher, cmd for debugging
  [serveCatGif, ['.* cat .*', 'cat .*', '.* cat'], 'catgif']
];

app.get('/', function(req, res) {
  if (!debug) {
    res.status(200).send('hello');
  }

  var print = function(ng, ok) {
    res.status(200).send(ng || ok);
  };

  var executed;
  commands.forEach(function(def) {
    if (req.query.cmd === def[2]) {
      def[0](print);
      executed = true;
      return;
    }
  });
  if (!executed) {
    console.log(req.query);
    print(null, 'unregistered');
  }
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

controller.hears(
  ['shutdown'],
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
  }
);

commands.forEach(function(def) {
  var type = 'direct_message,direct_mention,mention';
  controller.hears(def[1], type, function(bot, message) {
    def[0](function(ng, ok) {
      if (ng) {
        console.log(ng);
        return;
      }
      bot.reply(message, ok);
    });
  });
});

/**
 * Serve a Cat gif
 * @param {func} handler - handle values
 */
function serveCatGif(handler) {
  request('http://thecatapi.com/api/images/get?type=gif&format=xml', function(err, res, body) {
    if (err) {
      return handler(err, null);
    }
    var matched = body.match(/<url>([^<]+)<\/url>/);
    if (!(matched && matched[1])) {
      console.log('no matches:', body);
      return handler('service is temporally unavailable', null);
    }
    var gifurl = matched[1];
    handler(null, gifurl);
  });
}

// [END app]
