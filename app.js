// memo: try
// https://github.com/Microsoft/BotBuilder/tree/master/Node
//
// TBD
// - GAE でも一時停止できるよう sleep モード入れる
//
// [START app]
//

/**
 * For developer
 *
 * - add config/local.json and run app with NODE_ENV=local to make @bot-account isolate for development
 */

var debug = true;

var request = require('request');
var express = require('express');
var config = require('config');

var Botkit = require('botkit');
var Github = require('github-api');

var app = express();
var commands = [
  // func, matecher, cmd for debugging
  [serveCatGif, ['.* cat .*', 'cat .*', '.* cat'], 'catgif'],
  [echo, [], 'echo']
];

var standardDetectionType = 'direct_message,direct_mention,mention';

var ERR = {
  INVALID_MESSAGE: 'なんのことかわからんゾい',
  UNACCEPTABLE_REQUEST: 'なにか間違っておらんかノう ?',
  SERVICE_UNAVAILABLE: 'ちょっと調子が悪いようだゾい'
};

/**
 * Class: Emulate BotKit
 *
 * @param {object} response - response of express
 */
function BotEmulator(response) {
  this.messages = [];
  this.response = response;
}
BotEmulator.prototype = {
  say: function(message) {
    this.messages.push(message);
  },
  close: function() {
    this.response.status(200).send(this.messages.join('\n'));
  }
};

app.get('/', function(req, res) {
  if (!debug) {
    res.status(200).send('hello');
    return;
  }

  var bot = new BotEmulator(res);

  // for development
  //  emulate command by message
  var executed;
  commands.forEach(function(def) {
    if (req.query.cmd === def[2]) {
      def[0](bot, req.query.message || '')
        .then(() => bot.close(), err => console.log(err))
        .catch(err => {
          console.log(70);
          bot.close();
          console.error(err);
        });
      executed = true;
      return;
    }
  });
  if (!executed) {
    console.log(req.query);
    bot.close();
  }
});

// Start the server
var server = app.listen(process.env.PORT || '8080', '0.0.0.0', function() {
  console.log('App listening at http://%s:%s', server.address().address,
    server.address().port);
  console.log('Press Ctrl+C to quit.');
});

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

controller.hears(['.* cat .*', 'cat .*', '.* cat'],
  'direct_message,direct_mention,mention', (bot, message) => {
    serveCatGif(bot, message);
  }
);

/**
 * TBD: フラグ整理して高機能化
 *
 * - rollback（appcfg 使えない問題の解決が必要）
 * - master 以外のブランチを本番に上げる（バージョン切り替えは無し）
 */
controller.hears(['deploy'], standardDetectionType, (bot, message) => {
  console.log('accepted \'deploy\': ' + message.text);
  var id = idFromText(message.text);
  if (!id) {
    console.error('invalid id/text');
    return;
  }
  Promise.all([findPullRequest(id), findIssue(id)])
    .then(results => {
      var pr = results[0];
      var issue = results[1];

      // show & check PR status
      bot.reply(
          message,
          `${pr.title} (${pr.html_url})`
        );
      if (pr.margeable === false) {
        bot.reply(message, 'これはマージできないのゥ :eyes:');
        return;
      }
      if (pr.margeable === null) {
        bot.reply(message, 'まだ計算中のようぢゃのゥ.. また後で試すんぢゃ :eyes:');
        return;
      }
      if (pr.state !== 'open') {
        bot.reply(message, 'これはもうクローズされておるのゥ.. :eyes:');
        return;
      }

      if (0 && !pr.base.label.match(/:master$/)) {
        bot.reply(message, '派生ブランチはまだデプロイ対応しとらんのぢゃ.. すまんのぅ :eyes:');
        return;
      }
      if (!hasLabel(issue, 'LGTM')) {
        bot.reply(message, '`LGTM` が足りなイカのぅ :eyes:');
        return;
      }

      // start mrege & deploy
      bot.startConversation(message, function(err, convo) {
        if (err) {
          console.error(err);
          return;
        }
        convo.ask('これをデプロイしてよイカ? :eyes:', [{
          pattern: bot.utterances.yes,
          callback: (response, convo) => {
            convo.say('では `shipit` でゴーゴーぢゃ');
            mergePullRequest(ghrepo(), pr, 'shipit')
              .then(res => {
                if (res.status === 200) {
                  convo.say('マージしたぞィ');
                } else {
                  convo.say(`> ${res.message}`);
                  convo.say('およ.. 失敗か？ イカんのぅ.. :eyes:');
                }
                convo.next();
              })
              .catch(err => {
                if (err.status === 409) {
                  convo.say('なんと.. コンフリクトしておるぞイ :eyes:');
                } else {
                  convo.say('およ.. 失敗か？ イカんのぅ.. :eyes:');
                  convo.say(`> ${err.data.message}`);
                }
                convo.next();
              });
          }
        },
        {
          pattern: bot.utterances.no,
          default: true,
          callback: function(response, convo) {
            convo.say('ふむ... :eyes:');
            convo.next();
          }
        }]);
      });
    })
    .catch(err => console.error(err));
});

/**
 * Github instance initialized with token
 *
 * @return {object} -
 */
function gh() {
  if (!this.__instance__) {
    this.__instance__ = new Github({
      token: config.get('github.token')
    });
  }
  return this.__instance__;
}
/**
 * Get the repository
 * @return {object} -
 */
function ghrepo() {
  var ctor = ghrepo;
  if (!ctor.__instance__) {
    ctor.__instance__ = gh().getRepo(
        config.get('github.user'), config.get('github.repo')
      );
  }
  return ctor.__instance__;
}
/**
 * Accessing Github issues
 *
 * @return {object} -
 */
function ghissue() {
  var ctor = ghissue;
  if (!ctor.__instance__) {
    ctor.__instance__ = gh().getIssues(
        config.get('github.user'),
        config.get('github.repo')
    );
  }
  return ctor.__instance__;
}

/**
 * for development
 *
 * @param {object} bot - bot
 * @param {string} message - incoming message
 * @return {Promise} -
 */
function echo(bot, message) {
  return new Promise((resolve, reject) => {
    findPullRequest(idFromText(message)).then(pr => {
      bot.say(`${pr.title} (${pr.html_url}) - ${pr.state}`);
      if (pr.state !== 'open') {
        bot.say(ERR.UNACCEPTABLE_REQUEST);
        return resolve();
      }
      resolve();
    })
    .catch(reject);
  });
}

/**
 * Fetch Issue
 *
 * @param {int} id - a string which contains the number of issue
 * @return {Promise} - promise
 */
function findIssue(id) {
  return new Promise((resolve, reject) => {
    console.log('trying to fetch issue: ' + id);
    ghissue().getIssue(id).then(resp => {
      // resp keys: 'data', 'status', 'statusText', 'headers', 'config', 'request'
      if (resp.status !== 200) {
        return reject(ERR.SERVICE_UNAVAILABLE);
      }
      var dat = resp.data;
      resolve(dat);
    })
    .catch(err => console.error(err));
  });
}

/**
 * Fetch pull-request identified by the key
 *
 * @param {int} id -
 * @return {Promise} - see: https://developer.github.com/v3/pulls/#get-a-single-pull-request
 */
function findPullRequest(id) {
  return new Promise((resolve, reject) => {
    console.log('trying to fetch pull-request: ' + id);
    ghrepo().getPullRequest(id).then(resp => {
      // resp keys: 'data', 'status', 'statusText', 'headers', 'config', 'request'
      if (resp.status !== 200) {
        return reject(ERR.SERVICE_UNAVAILABLE);
      }
      var dat = resp.data;
      resolve(dat);
    })
    .catch(err => console.error(err));
  });
}

/**
 * "#29" のような ID 表記から int 部分を抜き出します
 *
 * @param {string} text -
 * @return {int} -
 */
function idFromText(text) {
  var matched = String(text).match(/#(\d+)/);
  if (!matched) {
    return 0;
  }
  return matched[1];
}

/**
 * returns true if hit
 *
 * @param {object} issue -
 * @param {string} labelName -
 * @return {bool} -
 */
function hasLabel(issue, labelName) {
  for (var i = 0; i < issue.labels.length; i++) {
    var label = issue.labels[i];
    if (label && label.name === labelName) {
      return true;
    }
  }
  return false;
}

/**
 * Serve a Cat gif
 *
 * @param {object} bot - bot
 * @param {string} message - message
 * @return {Promise} -
 */
function serveCatGif(bot, message) {
  return new Promise((resolve, reject) => {
    request('http://thecatapi.com/api/images/get?type=gif&format=xml', (err, res, body) => {
      if (err) {
        return reject(err);
      }
      var matched = body.match(/<url>([^<]+)<\/url>/);
      if (!matched) {
        console.log('no matches:', body);
        return reject('service is temporally unavailable');
      }
      var gifurl = matched[1];
      console.log(gifurl);
      bot.reply(message, gifurl);
      resolve();
    });
  });
}

/**
 * Add label defined by given names to the issue fetched by id
 *
 * @param {object} repo -
 * @param {int} issueId -
 * @param {string} label -
 * @return {Promise} -

function addLabel(repo, issueId, label) {
  return repo._request('POST',
      `/repos/${repo.__fullname}/issues/${issueId}/labels`,
      [label]);
}
*/

/**
 * Merge PR
 *
 * @param {object} repo -
 * @param {object} pr - part of pull-request's response json
 * @param {string} message -
 * @return {Promise} -
 */
function mergePullRequest(repo, pr, message) {
  var input = {
    'commit_title': '',
    'commit_message': message || 'emptymsg',
    'sha': pr.head.sha,
    'squash': false
  };
  return repo._request('PUT',
    `/repos/${repo.__fullname}/pulls/${pr.number}/merge`,
    input);
}

// [END app]
