/*
 * https://nutty.io
 * Copyright (c) 2014 krishna.srinivas@gmail.com All rights reserved.
 * GPLv3 License <http://www.gnu.org/licenses/gpl.txt>
 */

var authinfo = JSON.parse(Assets.getText("authinfo.json"));

ServiceConfiguration.configurations.remove({
	service: "google"
});

ServiceConfiguration.configurations.insert({
	service: "google",
	clientId: authinfo.google.clientId,
	secret: authinfo.google.secret
});


var awsid = authinfo.aws.awsid;
var awssecret = authinfo.aws.awssecret;

pipeserver = new Meteor.PipeServer();
chatserver = new Meteor.Broadcast();
var winston = Winston;
var client = Knox.createClient({
    key: awsid,
    secret: awssecret,
    bucket: 'nutty'
});

// db.users.ensureIndex({username:1}, {unique: true})
Meteor.users._ensureIndex({username:1}, {unique: true});
Meteor.users.allow({
	update: function (userId, doc, fields, modifier) {
		if (fields.length !== 1)
			return false;
		if (fields[0] !== "username")
			return false;
		return userId === doc._id
	}
});

//db.nuttysession.ensureIndex({expireAt:1}, {sparse: true, expireAfterSeconds: 0})
NuttySession = new Meteor.Collection('nuttysession');
NuttySession._ensureIndex({expireAt:1}, {sparse: true, expireAfterSeconds: 0});
NuttySession._ensureIndex({sessionid:1});
NuttySession.allow({
	update: function(userId, doc, fields, modifier) {
		if (fields.length !== 1)
			return false;
		if (fields[0] !== "rowcol" && fields[0] !== "desc")
			return false;
		if (doc.owner) {
			if (doc.owner === userId) {
				return true;
			} else
				return false;
		}
		//master user not logged in
		return true;
	}
});

//db.nuttyrecordings.ensureIndex({owner:1, createdAt:-1})
//db.nuttyrecordings.ensureIndex({filename:1}, {unique: true})

NuttyRecordings = new Meteor.Collection('nuttyrecordings');
NuttyRecordings._ensureIndex({owner:1, createdAt:-1});
NuttyRecordings._ensureIndex({filename:1}, {unique: true});

NuttyRecordings.allow({
	insert: function(userId, doc) {
		if (userId && userId === doc.owner) {
				return true;
		}else
			return false;
	},
	remove: function(userId, doc) {
		if (userId && userId === doc.owner) {
			client.del(doc.filename).on('response', function(res){
			}).end();
			return true;
		}
		else
			return false;
	}
});

Meteor.startup(function() {
	NuttySession.remove({$or:[{type:"master"}, {type:"slave"}]});
});

var methods = {};
methods['createMasterSession'] = function (clientid) {
	var sessionid = Random.hexString(10);
	NuttySession.insert({
		sessionid: sessionid,
		masterid: clientid,
		type: "session",
		masterconnected: false,
		owner: this.userId
	});
	return sessionid;
};
methods['userExists'] = function (username) {
	if (Meteor.users.findOne({username: username}))
		return true;
	else
		return false;
};

methods['s3downloadinfo'] = function(_key) {
        var ContentMD5 = "";
        var ContentType = "";
        var Expires;
        var expirytime = new Date();
        expirytime.setSeconds(1000);
        Expires = Math.floor(expirytime.getTime() / 1000);
        var StringToSign = "GET" + "\n" +
            ContentMD5 + "\n" +
            ContentType + "\n" +
            Expires + "\n" +
            "/nutty/" + _key;

	    var signature = CryptoJS.HmacSHA1(StringToSign, awssecret).toString(CryptoJS.enc.Base64);
        var retobj = {
            AWSAccessKeyId: awsid,
            Expires: Expires,
            Signature: signature
        };
        return retobj;
}

methods['s3uploadinfo'] = function(sessionid, clientid) {
    var bucket = "nutty";
    var key = sessionid + '.' + Random.hexString(6);
    var acl = "private";
    var type = "application/binary";
    var Expiration = new Date;
    Expiration.setSeconds(24*60*60); // expire in one day
    var JSON_POLICY = {
        // "expiration": "2020-01-01T00:00:00Z",
        "expiration": Expiration.getFullYear()+'-'+(Expiration.getMonth()+1)+'-'+Expiration.getDate()+'T'+Expiration.getHours()+':'+
                      Expiration.getMinutes()+':'+Expiration.getSeconds()+'Z',
        "conditions": [{
                "bucket": bucket
            },
            ["starts-with", "$key", key], {
                "acl": acl
            },
            ["starts-with", "$Content-Type", type],
            ["content-length-range", 0, 1048576]
        ]
    };
    var policy = new Buffer(JSON.stringify(JSON_POLICY)).toString('base64');
    var signature = CryptoJS.HmacSHA1(policy, awssecret).toString(CryptoJS.enc.Base64);
    var retobj = {
        key: key,
        AWSAccessKeyId: awsid,
        acl: acl,
        policy: policy,
        signature: signature,
        ContentType: type,
    }
    return retobj;
}


function userloggedin(sessionid, clientid, type, userId) {
	var user = Meteor.user();
	var username = "";
	if (user)
		username = user.username;
	if (!userId)
		return;
	if (type === 'master') {
		var s = NuttySession.findOne({sessionid:sessionid, masterid: clientid});
		if (!s)
			return;
		if (s.masterid !== clientid)
			return;
		NuttySession.update({
			sessionid: sessionid,
			type: "session"
		}, {$set: {owner: userId}});
	}

	NuttySession.update({
		sessionid: sessionid,
		clientid: clientid,
		type: type
	}, {$set: {username: username}});
}

function userloggedout (sessionid, clientid) {
	var s = NuttySession.findOne({sessionid:sessionid, masterid: clientid});
	if (s) {
		NuttySession.update({
			sessionid: sessionid,
			type: "session"
		}, {$set: {owner: ''}});
	}
	NuttySession.update({
		sessionid: sessionid,
		clientid: clientid,
	}, {$set: {username: ''}});
}

methods['userloggedin'] = function (sessionid, clientid, type) {
	if (!this.userId) {
		winston.info("user not loggedin");
		return;
	}
	userloggedin(sessionid, clientid, type, this.userId);
}

methods['userloggedout'] = function (sessionid, clientid) {
	userloggedout (sessionid, clientid);
}


Meteor.methods(methods);
Meteor.publish('mastersession', function(sessionid, clientid) {
	var timer;
	var s = NuttySession.findOne({sessionid: sessionid, type: "session", masterid: clientid});
	if (!s)
		return;
	function _f() {
		var d = new Date();
		d.setDate(d.getDate()+5);
		NuttySession.update({sessionid: sessionid, masterid: clientid}, {$set:{expireAt:d}});
	}
	_f();
	timer = Meteor.setInterval(_f, 1000*60*60*24); // once per day
	var user = Meteor.users.findOne({_id:this.userId});
	var username = "";
	if (user)
		username = user.username;
	NuttySession.upsert({sessionid: sessionid, clientid: clientid, type: "master"}, {$set:{sessionid: sessionid, clientid: clientid, type: "master", username: username, userId: this.userId} }, {multi:true});
	this.onStop(function() {
		Meteor.clearInterval(timer);
		NuttySession.remove({sessionid: sessionid, clientid: clientid});
	});
	return NuttySession.find({sessionid:sessionid}, {fields:{clientid: 0, masterid: 0}});
});

Meteor.publish('slavesession', function(sessionid, clientid) {
	var s = NuttySession.findOne({sessionid: sessionid, type: "session"});
	if (!s)
		return;
	var user = Meteor.users.findOne({_id:this.userId});
	var username = "";
	if (user)
		username = user.username;
	NuttySession.upsert({sessionid: sessionid, clientid: clientid, type: "slave"}, {$set:{sessionid: sessionid, clientid: clientid, type: "slave", username: username, userId: this.userId} }, {multi:true});
	this.onStop(function() {
		NuttySession.remove({sessionid: sessionid, clientid: clientid});
	});
	return NuttySession.find({sessionid:sessionid}, {fields:{clientid: 0, masterid: 0}});
});

Meteor.publish('ownedsessions', function () {
	return NuttySession.find({type:"master", userId:this.userId}, {fields:{clientid: 0}});
});

Meteor.publish('ownedrecordings', function() {
	return NuttyRecordings.find({owner:this.userId});
});
