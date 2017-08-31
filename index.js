const Sonos = require('sonos');
const urllibsync = require('urllib-sync');
const urlencode = require('urlencode');
const fs = require('fs');
const config = require('nconf');
const Entities = require('html-entities').AllHtmlEntities;
const slackclient = require('@slack/client');
const _ = require('underscore');

config.argv()
  .env()
  .file({ file: 'config.json' })
  .defaults({
    'adminChannel':    'music-admin',
    'standardChannel': 'music',
    'maxVolume':       '75',
    'market':          'US',
    'blacklist':       []
  });

let adminChannel = config.get('adminChannel');
let standardChannel = config.get('standardChannel');
let sonos = new Sonos.Sonos(config.get('sonos'));
let token = config.get('token');
let maxVolume = config.get('maxVolume');
let market = config.get('market');
let blacklist = config.get('blacklist');
let apiKey = new Buffer(config.get('apiKey')).toString('base64');
if(!Array.isArray(blacklist)) {
    blacklist = blacklist.replace(/\s*(,|^|$)\s*/g, "$1").split(/\s*,\s*/);
}

let devices = {};
let searchLimit = 10;

var gongCounter = 0;
var gongLimit = 3;
var gongLimitPerUser = 1;
var gongScore = {};
var gongMessage = [
    "Is it really all that bad??",
    "Is it that distracting??",
    "Your eardrums are going to combust if this continues playing??",
    "Would some harp music be better??",
    "It is bad isn't it...",
    "Booo!!! Please skip the traaaaaack!"
];

let voteVictory = 3;
let voteLimit = 1;
let votes = {};

let gongTrack = ""; // What track was a GONG called on

const RtmClient = slackclient.RtmClient;
const WebClient = slackclient.WebClient;
const RTM_EVENTS = slackclient.RTM_EVENTS;
const MemoryDataStore = slackclient.MemoryDataStore;

let slack = new RtmClient(token, {
    logLevel: 'info',
    dataStore: new MemoryDataStore(),
    autoReconnect: true,
    autoMark: true
});

slack.start();

slack.on('open', function() {
    let channel, channels, group, groups, id, messages, unreads;
    channels = [standardChannel];
    groups = [];
    channels = (function() {
        let _ref, _results;
        _ref = slack.channels;
        _results = [];
        for (id in _ref) {
            channel = _ref[id];
            if (channel.is_member) {
                _results.push("#" + channel.name);
            }
        }
        return _results;
    })();

    groups = (function() {
        let _ref, _results;
        _ref = slack.groups;
        _results = [];
        for (id in _ref) {
            group = _ref[id];
            if (group.is_open && !group.is_archived) {
                _results.push(group.name);
            }
        }
        return _results;
    })();

    Sonos.search({timeout: 2000}, function (device, model) {
        let data = {ip: device.host, port: device.port, model: model}

        device.getZoneAttrs(function (err, attrs) {
            if (!err) {
                _.extend(data, attrs)
            }
            device.getZoneInfo(function (err, info) {
                if (!err) {
                    _.extend(data, info)
                }
                device.getTopology(function (err, info) {
                    if (!err) {
                        info.zones.forEach(function (group) {
                            if (group.location === 'http://' + data.ip + ':' + data.port + '/xml/device_description.xml') {
                            _.extend(data, group)
                            }
                        });
                    }

                    let name = '';
                    switch(data.name) {
                        case 'The Light Side':
                            name = 'light';
                            break;
                        case 'The Dark Side':
                            name = 'dark';
                            break;
                        case 'Reception':
                            name = 'reception'
                            break;
                        default:
                            break;
                    }

                    devices[name] = { device: new Sonos.Sonos(data.ip, 1400), name: data.name };
                });
            });
        });
    });

    return console.log("Starting...");
});

slack.on(RTM_EVENTS.MESSAGE, function(message) {
    console.log(message);
    let channel, channelError, channelName, errors, response, text, textError, ts, type, typeError, user, userName;

    channel = slack.dataStore.getChannelGroupOrDMById(message.channel);
    user = slack.dataStore.getUserById(message.user);
    response = '';
    type = message.type, ts = message.ts, text = message.text;
    channelName = (channel != null ? channel.is_channel : void 0) ? '#' : '';
    channelName = channelName + (channel ? channel.name : 'UNKNOWN_CHANNEL');
    userName = (user != null ? user.name : void 0) != null ? "@" + user.name : "UNKNOWN_USER";
    console.log("Received: " + type + " " + channelName + " " + userName + " " + ts + " \"" + text + "\"");
    if (type === 'message' && (text != null) && (channel != null)) {

        if (blacklist.indexOf(userName) !== -1) {
            console.log('User ' + userName + ' is blacklisted');
            slack.sendMessage("Nice try " + userName + ", you're banned :)", channel.id)
            return false;
        } else {
            let prefix = 'sonos';
            let input = text.split(' ');
            let term = (input[0].toLowerCase() === 'sonos') ? `${input[0]} ${input[1]}`.toLowerCase() : input[0].toLowerCase();
            console.log('term', term);
            switch(term) {
                case ':heavy_plus_sign:':
                case `${prefix} add`:
                    _add(input, channel);
                break;
                case `${prefix} search`:
                    _search(input, channel);
                break;
                case `${prefix} append`:
                    _append(input, channel);
                break;
                case `${prefix} skip`:
                case `${prefix} next`:
                    _nextTrack(channel);
                break;
                case `${prefix} gongPlay`:
                    _gongPlay(input, channel);
                break;
                case `${prefix} stop`:
                case ':raised_hand_with_fingers_splayed:':
                    _stop(input, channel);
                break;
                case `${prefix} flush`:
                case ':toilet:':
                    _flush(input, channel);
                break;
                case `${prefix} play`:
                    _play(input, channel);
                break;
                case `${prefix} pause`:
                    _pause(input, channel);
                break;
                case `${prefix} playpause`:
                    _playpause(input, channel);
                break;
                case `${prefix} help`:
                    _help(input, channel);
                break;
                case `${prefix} dong`:
                case `${prefix} gong`:
                case ':poop:':
                case ':hankey:':
                case ':(':
                    _gong(channel, userName);
                break;
                case `${prefix} gongcheck`:
                case `${prefix} dongcheck`:
                    _gongcheck(channel, userName);
                break;
                case `${prefix} ungong`:
                    _ungong(channel, userName);
                break;
                case `${prefix} say`:
                    // _say(input, channel);
                break;
                case `${prefix} current`:
                    _currentTrack(channel);
                break;
                case `${prefix} vote`:
                    _vote(text, channel, userName);
                break;
                case `${prefix} previous`:
                    _previous(input, channel);
                break;
                case `${prefix} list`:
                case `${prefix} ls`:
                case `${prefix} playlist`:
                    _showQueue(channel);
                break;
                case `${prefix} volume`:
                    _getVolume(channel);
                break;
                case `${prefix} setvolume`:
                    _setVolumeByName(input, channel);
                break;
                case `${prefix} devices`:
                    _listDevices(channel);
                break;
                case `${prefix} mute`:
                    _mute(input, channel);
                break;
                case `${prefix} volumeup`:
                case ':loud_sound:':
                    _increaseVolume(channel);
                break;
                case `${prefix} volumedown`:
                case ':sound:':
                    _decreaseVolume(channel);
                break;
                case `${prefix} status`:
                    _status(channel);
                break;
                case `${prefix} blacklist`:
                    _blacklist(input, channel);
                break;
                default:
                break;
            }
        } // end if blacklist

    } else {
        typeError = type !== 'message' ? "unexpected type " + type + "." : null;
        textError = text == null ? 'text was undefined.' : null;
        channelError = channel == null ? 'channel was undefined.' : null;
        errors = [typeError, textError, channelError].filter(function(element) {
            return element !== null;
        }).join(' ');
        return console.log("Could not respond. " + errors);
  }
});

slack.on('error', function(error) {
    console.log('error');
    return console.error("Error: " + error);
});

function _getVolume(channel, data) {
    for (let key in devices) {
        devices[key].device.getVolume(function(err, vol) {
            console.log(err, vol);
            slack.sendMessage('Volume for ' + devices[key].name + ' is now ' + vol + 'dB _(ddB)_', channel.id);
        });
    };
}

function _getVolumeCallback(channel, name, volume) {
    slack.sendMessage('Volume for ' + name + ' is now ' + volume + 'dB _(ddB)_', channel.id);
}

function _setVolumeByName(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }

    let data = devices[input[2]];
    let vol = input[3];

    if(isNaN(vol)) {
        slack.sendMessage('Nope.', channel.id);
        return;
    } else {
        vol = Number(vol);
        console.log(vol);
        if(vol > maxVolume) {
            slack.sendMessage('You also could have tinnitus _(say: tih-neye-tus)_', channel.id);
        } else {
            data.device.setVolume(vol, function() {
                _getVolumeCallback(channel, data.name, vol);
            });
        }
    }
}

function _listDevices(channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }

    let message = '';
    for (let key in devices) {
        message += "\n";
        message += devices[key].name + ' is called ' + key;
    };
    slack.sendMessage(message, channel.id);
}

function _mute(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }

    for (let key in devices) {
        devices[key].setVolume(0, function() {
            _getVolumeCallback(channel, data.name, vol);
        });
    };
}

function _increaseVolume(channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }

    for (let key in devices) {
        if (key !== 'reception') {
            devices[key].device.getVolume(function(err, currentVol) {
                if(isNaN(currentVol)) {
                    slack.sendMessage('Nope.', channel.id);
                    return;
                } else {
                    vol = Number(currentVol) + 10;
                    if(vol > maxVolume) {
                        slack.sendMessage(data.name + ', you also could have tinnitus _(say: tih-neye-tus)_', channel.id);
                    } else {
                        devices[key].device.setVolume(vol, function() {
                            _getVolumeCallback(channel, devices[key].name, vol);
                        });
                    }
                }
            });
        }
    };
}

function _decreaseVolume(channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }

    for (let key in devices) {
        if (key !== 'reception') {
            devices[key].device.getVolume(function(err, currentVol) {
                if(isNaN(currentVol)) {
                    slack.sendMessage('Nope.', channel.id);
                    return;
                } else {
                    if(currentVol > 0) {
                        vol = Number(currentVol) - 10;
                        devices[key].device.setVolume(vol, function() {
                            _getVolumeCallback(channel, devices[key].name, vol);
                        });
                    } else {
                        slack.sendMessage('We canna go lower than 0 cap\'n', channel.id);
                    }
                }
            });
        }
    };
}

function _getQueue() {
    let res = null;
   sonos.getQueue(function (err, result) {
        res =  result;
    });
    return res;
}

function _showQueue(channel, cb) {
   sonos.getQueue(function (err, result) {
        if (err) {
            if(cb) {
                return (err, null);
            }
            console.log(err)
            slack.sendMessage('Couldn\'t fetch the queue', channel.id);

        } else {
            if(cb) {
                return cb(null, result.items);
            }
            _currentTrack(channel, function(err, track) {
                let message = "Total tracks in queue: " + result.total + "\n"
                + "====================="
                result.items.map(
                    function(item, i){
                        message += "\n";
                        if(item['title'] === track.title) {
                message += ":notes: " + "_#" + i + "_ *Title:* " + item['title'];
                message += " *Artist:* " + item['artist'];
                        } else {
                            message += ">_#" + i + "_ *Title:* " + item['title'];
                            message += " *Artist:* " + item['artist'];
                        }
                    }
                )
                slack.sendMessage(message, channel.id);
            });
        }
    });
}

// Need to track what song has had a GONG called
// If the GONG was called on the previous song, reset
function _gong(channel, userName) {

  console.log("_gong...");

    _currentTrackTitle(channel, function(err, track) {
        console.log("_gong > track: " + track);

        // Get message
        console.log("gongMessage.length: " + gongMessage.length);
        let ran = Math.floor(Math.random() * gongMessage.length);
        console.log("gongMessage > ran: " + ran);
        console.log("gongMessage > gongMessage: " + gongMessage);
        let randomMessage = gongMessage[ran];
        console.log("gongMessage: " + randomMessage);

        // Need a delay before calling the rest
        if(!(userName in gongScore)) {
            gongScore[userName] = 1
            gongCounter++;
            slack.sendMessage(randomMessage + " Oh well.. This is GONG " + gongCounter + " out of " + gongLimit + " for " + track, channel.id);
            if(gongCounter >= gongLimit) {
                slack.sendMessage("The music got GOONGED!!", channel.id);
                // _gongPlay(channel, true);
                _nextTrack(channel, true)
                gongCounter = 0;
                gongScore={}
            }
        } else{
            if(gongScore[userName] >= gongLimitPerUser) {
                slack.sendMessage("Are you trying to cheat " + userName + "? DENIED!", channel.id);
            }else {
                gongScore[userName] = gongScore[userName] + 1
                gongCounter++;
                slack.sendMessage(randomMessage + " Oh well.. This is GONG " + gongCounter + " out of " + gongLimit + " for " + track, channel.id);
                if(gongCounter >= gongLimit) {
                    slack.sendMessage("The music got GOONGED!", channel.id);
                    // _gongPlay(channel);
                    _nextTrack(channel);
                     gongCounter = 0;
                     gongScore={}
                }
            }
        }
    });
}

function _gongcheck(channel, userName) {
    console.log("_gongcheck...");

  _currentTrackTitle(channel, function(err, track) {
      console.log("_gongcheck > track: " + track);

        slack.sendMessage("The GONG is currently " + gongCounter + " out of " + gongLimit + " for " + track, channel.id);

        let gongers = "";
        for (let key in gongScore) {
            if (gongers.length > 0) {
                gongers += ", " + key;
            } else {
                gongers += key;
            }
        }

      if (gongers.length > 0) {
        slack.sendMessage("The GONG'ERS are " + gongers, channel.id);
      }

    });
}


function _ungong(channel, userName) {
    console.log("_ungong...");
  slack.sendMessage("DENIED!! As much as you want to listen to this, afraid we belong to the Democratic Republic of Sonos.", channel.id);
}


function _previous(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }
    sonos.previous(function(err, previous) {
        console.log(err, previous);
    });
}

function _help(input, channel) {
    let message = 'Current commands!\n' +
    '=====================\n' +
    '`sonos add` or :heavy_plus_sign: _text_ : Add song to the queue and start playing if idle.\n' +
    '`sonos current` : list current track\n' +
    '`sonos search` _text_ : search for a track, does NOT add it to the queue\n' +
    '`sonos gong` or 💩 : The current track is trash! Vote for skipping this track\n' +
    '`sonos gongcheck` : How many gong votes there are currently, as well as who has GONGED.\n' +
    '`sonos vote` _exactSongTitle_ : Vote for a specific song title in the queue.\n' +
    '`sonos list` : list current queue\n' +
    '------ ADMIN FUNCTIONS ------\n' +
    '`sonos status` : show current status of Sonos\n' +
    '`sonos append` _text_ : Append a song to the previous playlist and start playing the same list again.\n' +
    '`sonos volume` : view current volume\n' +
    '`sonos flush` or 🚽 : flush the current queue\n' +
    '`sonos volumeup` or :loud_sound: : increase volume by 10\n' +
    '`sonos volumedown` or :sound: : decrease volume by 10\n' +
    '`sonos setvolume` _devicename_ _volume_ : set volume of the device to the amount\n' +
    '`sonos devices` : get the short names of the current devices\n' +
    '`sonos play` : play track\n' +
    '`sonos stop` or :raised_hand_with_fingers_splayed: : stop\n' +
    '`sonos pause` : pause\n' +
    '`sonos playpause` : resume after pause\n' +
    '`sonos next` or `sonos skip` : play next track\n' +
    '`sonos previous` : play previous track\n' +
    '`sonos blacklist` : show users on blacklist\n' +
    '`sonos blacklist add @username` : add `@username` to the blacklist\n' +
    '`sonos blacklist del @username` : remove `@username` from the blacklist\n' +
    '=====================\n'
    slack.sendMessage(message, channel.id);
}

function _play(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!!", channel.id)
        return
    }
    sonos.selectQueue(function (err, result) {
        sonos.play(function (err, playing) {
             console.log([err, playing])
                if(playing) {
                    slack.sendMessage("Now playing the music", channel.id);
                }
            });
    });
}

function _stop(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }
    sonos.stop(function (err, stopped) {
        console.log([err, stopped])
        if(stopped) {
            slack.sendMessage("Why.. WHYY!?", channel.id);
        }
    });
}

function _pause(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!!", channel.id)
        return
    }
    sonos.selectQueue(function (err, result) {
        sonos.pause(function (err, paused) {
             console.log([err, paused])
                slack.sendMessage(".. takning a nap....", channel.id);
            });
    });
}

function _playpause(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!!", channel.id)
        return
    }
    sonos.play(function (err, playing) {
            console.log([err, playing])
        if(playing) {
            slack.sendMessage("..resuming after sleep...", channel.id);
        }
    });
}

function _flush(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }
    sonos.flush(function (err, flushed) {
        console.log([err, flushed])
        if(flushed) {
            slack.sendMessage('Ok.. clean slate..  Let´s make it better this time!!', channel.id);
        }
    });
}

function _say(input, channel) {
    let text = input[1];
    // Replace all spaces with a _ because Sonos doesn't support spaces
    text = text.replace(/ /g, '_');

    // For supported languages see www.voicerss.org/api/documentation.aspx
    // This url just redirects to voicerss because of the specific url format for the sonos
    let url = 'http://i872953.iris.fhict.nl/speech/en-us_' + encodeURIComponent(text) + '.mp3';

    sonos.queueNext(url, function (err, playing) {
        console.log([err, playing]);
    });
}

function _gongPlay(channel) {
    sonos.play('sound/gong.mp3', function (err, playing) {
        console.log([err, playing])
    });
}


function _nextTrack(channel, byPassChannelValidation) {
    if(channel.name !== adminChannel && !byPassChannelValidation){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }
    sonos.next(function (err, nexted) {
        if(err) {
            console.log(err);
        } else {
            console.log(nexted);
            slack.sendMessage('Playing the next track...', channel.id);
        }
    });
}

function _currentTrack(channel, cb) {

    sonos.currentTrack(function(err, track) {
        if(err) {
            console.log(err);
            if(cb) {
                return cb(err, null);
            }
        } else {
            if(cb) {
                return cb(null, track);
            }
            console.log(track);
            let fmin = ''+Math.floor(track.duration/60);
            fmin = fmin.length == 2 ? fmin : '0'+fmin;
            let fsec = ''+track.duration%60;
            fsec = fsec.length == 2 ? fsec : '0'+fsec;

            let pmin = ''+Math.floor(track.position/60);
            pmin = pmin.length == 2 ? pmin : '0'+pmin;
            let psec = ''+track.position%60;
            psec = psec.length == 2 ? psec : '0'+psec;

            let message = 'We´re currently listening to *' + track.artist + '* by *' + track.title + '* ('+pmin+':'+psec+'/'+fmin+':'+fsec+')';
            slack.sendMessage(message, channel.id);
        }
    });

    // devices.forEach(function(data) {
    //     data.device.currentTrack(function(err, track) {
    //         console.log(data.name);
    //         if(err) {
    //             console.log(err);
    //             if(cb) {
    //                 return cb(err, null);
    //             }
    //         } else {
    //             if(cb) {
    //                 return cb(null, track);
    //             }
    //             console.log(track);
    //             let fmin = ''+Math.floor(track.duration/60);
    //             fmin = fmin.length == 2 ? fmin : '0'+fmin;
    //             let fsec = ''+track.duration%60;
    //             fsec = fsec.length == 2 ? fsec : '0'+fsec;

    //             let pmin = ''+Math.floor(track.position/60);
    //             pmin = pmin.length == 2 ? pmin : '0'+pmin;
    //             let psec = ''+track.position%60;
    //             psec = psec.length == 2 ? psec : '0'+psec;

    //             let message = 'We´re rocking out on ' + data.name + ' to *' + track.artist + '* - *' + track.title + '* ('+pmin+':'+psec+'/'+fmin+':'+fsec+')';
    //             slack.sendMessage(message, channel.id);
    //         }
    //     });
    // });
}

function _currentTrackTitle(channel, cb) {
    sonos.currentTrack(function(err, track) {
      let _track = "";
        if(err) {
            console.log(err);
        } else {
            _track = track.title;
            console.log("_currentTrackTitle > title: " + _track);
            console.log("_currentTrackTitle > gongTrack: " + gongTrack);

            if (gongTrack !== "") {
              if (gongTrack !== _track) {
                console.log("_currentTrackTitle > different track, reset!");
                gongCounter = 0;
                gongScore={};

                //return cb(err, null);
              } else {
                  console.log("_currentTrackTitle > gongTrack is equal to _track");
              }
            } else {
                console.log("_currentTrackTitle > gongTrack is empty");
            }

            gongTrack = _track;

        }

        cb(err, _track);
    });
}

function _append(input, channel) {
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!!", channel.id)
        return
    }

	let accessToken = _getAccessToken(channel.id);
    if (!accessToken) {
        return false;
    }

    let query = '';
    for(let i = 2; i < input.length; i++) {
        console.log(input[i]);
        query += urlencode(input[i]);
        if(i < input.length-1) {
            query += ' ';
        }
    }

    let getapi = urllibsync.request('https://api.spotify.com/v1/search?q=' + query + '&type=track&limit=3&market=' + market + '&access_token=' + accessToken);
    let data = JSON.parse(getapi.data.toString());
    console.log(data);
    if(data.tracks.items && data.tracks.items.length > 0) {
        let spid = data.tracks.items[0].id;
        let uri = data.tracks.items[0].uri;
        let external_url = data.tracks.items[0].external_urls.spotify;

        let albumImg = data.tracks.items[0].album.images[2].url;
        let trackName = data.tracks.items[0].artists[0].name + ' - ' + data.tracks.items[0].name;

        sonos.getCurrentState(function (err, state) {
            if(err) {
                console.log(err);
            } else {
                if (state === 'stopped') {
                    // Ok, lets start again..  NO Flush
                    //Add the track to playlist...

                    // Old version..  New is supposed to fix 500 problem...
                    // sonos.addSpotifyQueue(spid, function (err, res) {

                    sonos.addSpotify(spid, function (err, res) {
                        let message = '';
                        if(res) {
                            let queueLength = res[0].FirstTrackNumberEnqueued;
                            console.log('queueLength', queueLength);
                            message = 'I have added "' + trackName + '" to the queue!\n'+albumImg+'\nPosition in queue is ' + queueLength;
                        } else {
                            message = 'Error!';
                            console.log(err);
                        }
                        slack.sendMessage(message, channel.id);
                        if(res) {
                            // And finally..  lets start rocking...
                            sonos.selectQueue(function (err, result) {
                                sonos.play(function (err, playing) {
                                    console.log([err, playing])
                                    if(playing) {
                                        slack.sendMessage('Appending to old playlist... lack of creativity?!', channel.id);
                                    }
                                });
                            });
                        }
                   });
                } else if (state === 'playing') {
                    //Tell them to use add...
                   slack.sendMessage("Already playing...  use add..", channel.id)
                } else if (state === 'paused') {
                    slack.sendMessage("I'm frozen! Alive!", channel.id)
                } else if (state === 'transitioning') {
                        slack.sendMessage("Mayday, mayday! I'm sinking!!", channel.id)
                } else if (state === 'no_media') {
                    slack.sendMessage("Nothing to play, nothing to do. I'm rethinking my life", channel.id)
                } else {
                      slack.sendMessage("No freaking idea. What is this [" + state + "]?", channel.id)
                }
            }
        });
    } else {
        slack.sendMessage('Sorry could not find that track :frowning: Have your tried using *search* to find it?', channel.id);
    }
}

function _add(input, channel) {
	let accessToken = _getAccessToken(channel.id);
	if (!accessToken) {
		return false;
	}

    let query = '';
    for(let i = 2; i < input.length; i++) {
        query += urlencode(input[i]);
        if(i < input.length-1) {
            query += ' ';
        }
    }

    let getapi = urllibsync.request('https://api.spotify.com/v1/search?q=' + query + '&type=track&limit=1&market=' + market + '&access_token=' + accessToken);
    let data = JSON.parse(getapi.data.toString());
    console.log(data);
    if(data.tracks && data.tracks.items && data.tracks.items.length > 0) {
        let spid = data.tracks.items[0].id;
        let uri = data.tracks.items[0].uri;
        let external_url = data.tracks.items[0].external_urls.spotify;

        let albumImg = data.tracks.items[0].album.images[2].url;
        let trackName = data.tracks.items[0].artists[0].name + ' - ' + data.tracks.items[0].name;

        sonos.getCurrentState(function (err, state) {
            if(err) {
                console.log(err);
            } else {
                if (state === 'stopped') {
                    // Ok, lets start again..  Flush old playlist
                    sonos.flush(function (err, flushed) {
                        console.log([err, flushed])
                        if(flushed) {
                            slack.sendMessage('Clean slate..  Let´s make it better this time!!', channel.id);
                            //Then add the track to playlist...

                            // Old version..  New is supposed to fix 500 problem...
                            //sonos.addSpotifyQueue(spid, function (err, res) {

                            sonos.addSpotify(spid, function (err, res) {
                                let message = '';
                                if(res) {
                                    let queueLength = res[0].FirstTrackNumberEnqueued;
                                    console.log('queueLength', queueLength);
                                    message = 'I have added "' + trackName + '" to the queue!\n'+albumImg+'\nPosition in queue is ' + queueLength;
                                } else {
                                    message = 'Error!';
                                    console.log(err);
                                }
                                slack.sendMessage(message, channel.id);
                                if(res) {
                                    // And finally..  lets start rocking...
                                    sonos.selectQueue(function (err, result) {
                                        sonos.play(function (err, playing) {
                                            console.log([err, playing])
                                            if(playing) {
                                                slack.sendMessage('Flushed old playlist...  Time to rock again!', channel.id);
                                            }
                                        });
                                    });
                                }
                            });
                        }
                    });
                } else if (state === 'playing') {
                    //Add the track to playlist...

                    // Old version..  New is supposed to fix 500 problem...
                    // sonos.addSpotify(spid, function (err, res) {
                    sonos.addSpotifyQueue(spid, function (err, res) {
                        console.log(res);
                        let message = '';
                        if(res) {
                            let queueLength = res[0].FirstTrackNumberEnqueued;
                            console.log('queueLength', queueLength);
                            message = 'I have added "' + trackName + '" to the queue!\n'+albumImg+'\nPosition in queue is ' + queueLength;
                        } else {
                            message = 'Error!';
                            console.log(err);
                        }
                        slack.sendMessage(message, channel.id)
                    });
                } else if (state === 'paused') {
                    slack.sendMessage("I'm frozen! Alive!", channel.id)
                } else if (state === 'transitioning') {
                    slack.sendMessage("Mayday, mayday! I'm sinking!!", channel.id)
                } else if (state === 'no_media') {
                    slack.sendMessage("Nothing to play, nothing to do. I'm rethinking my life", channel.id)
                } else {
                  slack.sendMessage("No freaking idea. What is this [" + state + "]?", channel.id)
                }
            }
        });
    } else {
        slack.sendMessage('Sorry could not find that track :frowning: Have your tried using *search* to find it?', channel.id);
    }
}

function _search(input, channel) {
	let accessToken = _getAccessToken(channel.id);
	if (!accessToken) {
		return false;
	}

    let query = '';
    for(let i = 2; i < input.length; i++) {
        query += urlencode(input[i]);
        if(i < input.length-1) {
            query += ' ';
        }
    }

    let getapi = urllibsync.request('https://api.spotify.com/v1/search?q=' + query + '&type=track&limit=' + searchLimit + '&market=' + market + '&access_token=' + accessToken);
    let data = JSON.parse(getapi.data.toString());
    console.log(data);
    if(data.tracks && data.tracks.items && data.tracks.items.length > 0) {
        let trackNames = [];

        for(let i = 1; i <= data.tracks.items.length; i++) {

            let spid = data.tracks.items[i-1].id;
            let uri = data.tracks.items[i-1].uri;
            let external_url = data.tracks.items[i-1].external_urls.spotify;

            let albumImg = data.tracks.items[i-1].album.images[2].url;
            let trackName = data.tracks.items[i-1].artists[0].name + ' - ' + data.tracks.items[i-1].name;

            trackNames.push(trackName);

        }

        //Print the result...
        let message = 'I found the following track(s):\n```\n' + trackNames.join('\n') + '\n```\nIf you want to play it, use the `add` command..\n';
        slack.sendMessage(message, channel.id)

    } else {
        slack.sendMessage('Sorry could not find that track :frowning:', channel.id);
    }
}

function _vote(text, channel, userName) {
    let trackName = text.substring(text.indexOf(' ')+1)

    //Decode any htmlentities as returned in the trackName
    entities = new Entities();
    trackName = entities.decode(trackName);

    sonos.getQueue(function (err, result) {
        if (err || !result) {
            console.log(err)
            slack.sendMessage('Couldn\'t fetch the queue', channel.id);
        } else {
            for(let i = 0; i < result.items.length; i++)
            {
                let item = result.items[i]
                if(item['title'] === trackName){
                    if(trackName in votes)
                    {
                        let listOfVotes = votes[trackName]
                        let votedTimes = 0
                        for(let i = 0; i < listOfVotes.length; ++i)
                        {
                            if(listOfVotes[i] === userName)
                            {
                                votedTimes++;
                            }
                        }

                        if(votedTimes >= voteLimit)
                        {
                            slack.sendMessage("Voting so many times " + userName + "! DENIED!", channel.id)
                            return
                        }else
                        {
                            votes[trackName].push(userName)
                            slack.sendMessage("Valid vote by " + userName + "!", channel.id)
                            votedTimes++
                        }
                        if(listOfVotes.length >= voteVictory)
                        {
                            slack.sendMessage("Vote passed! Will put " + trackName + " on top! Will reset votes for this track.", channel.id)
                            delete votes[trackName]
                            // Should play item
                            _currentTrack(channel,
                                function(error, track){
                                    sonos.addSpotifyTagToPositionInQueue(item['uri'], track.positionInQueue + 1, function (err, result) {
                                        if (err) {console.log(err)}
                                            else{_nextTrack(channel, true);}
                                    })
                                }
                            )
                        }
                    }else{
                        votes[trackName] = [userName]
                        slack.sendMessage("Valid vote by " + userName + "!", channel.id)
                    }
                    return
                }
            }
        }
    })
}

function _status(channel){
    if(channel.name !== adminChannel){
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!!", channel.id)
        return
    }

    sonos.getCurrentState(function (err, state) {
        if(err) {
            console.log(err);
        } else {
            if (state === 'stopped') {
                slack.sendMessage("Sonos is currently sleeping!", channel.id)
            } else if (state === 'playing') {
                slack.sendMessage("Sonos is rocking!", channel.id)
            } else if (state === 'paused') {
                slack.sendMessage("I'm frozen! Alive!", channel.id)
            } else if (state === 'transitioning') {
                slack.sendMessage("Mayday, mayday! I'm sinking!!", channel.id)
            } else if (state === 'no_media') {
                slack.sendMessage("Nothing to play, nothing to do. I'm rethinking my life", channel.id)
            }else {
                slack.sendMessage("No freaking idea. What is this [" + state + "]?", channel.id)
            }
        }
    });
}

function _blacklist(input, channel){
    if (channel.name !== adminChannel) {
        console.log("Only admins are allowed to do this. Please ask nicely!")
        slack.sendMessage("Only admins are allowed to do this. Please ask nicely!", channel.id)
        return
    }

    let action = ((input[1]) ? input[1] : '');
    let slackUser = ((input[2]) ? slack.dataStore.getUserById(input[2].slice(2, -1)) : '');

    if (input[2] != '' && typeof slackUser !== 'undefined') {
        let username = '@'+slackUser.name;
    } else if (input[2] != '') {
        message = 'The user ' + (input[2]) + ' is not a valid Slack user.';
    }

    if (action == '') {
        message = 'The following users are blacklisted:\n```\n' + blacklist.join('\n') + '\n```';

    } else if (typeof username !== 'undefined') {

        if (action == 'add') {
            let i = blacklist.indexOf(username);
            if (i == -1) {
                blacklist.push(username);
                message = 'The user ' + username + ' has been added to the blacklist.';
            } else {
                message = 'The user ' + username + ' is already on the blacklist.';
            }

        } else if (action == 'del') {
            let i = blacklist.indexOf(username);
            if (i != -1) {
                blacklist.splice(i, 1);
                message = 'The user ' + username + ' has been removed from the blacklist.';
            } else {
                message = 'The user ' + username + ' is not on the blacklist.';
            }

        } else {
            message = 'Usage: `blacklist add|del @username`';
        }
    }
    slack.sendMessage(message, channel.id)
}

function _getAccessToken(channelid) {
    if (apiKey === '') {
        slack.sendMessage('You did not set up an API key. Naughty.', channelid);
        return false;
    }

    let getToken = urllibsync.request('https://accounts.spotify.com/api/token', {
        method: "POST",
        data: { 'grant_type': 'client_credentials' },
        headers: { 'Authorization': 'Basic ' + apiKey }
    });
    let tokendata = JSON.parse(getToken.data.toString());
    return tokendata.access_token;
}

function _sendGiphyResponse(input, channel) {
    let string = (input.length > 1) ? input[1] : input[0];
    slack.sendMessage('I can do that too, ' + string + '!', channel.id);
}


module.exports = function(number, locale) {
    return number.toLocaleString(locale);
};
