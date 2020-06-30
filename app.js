const express = require('express');
const bodyParser = require('body-parser');
const Services = require('./Services.js');
const { createHmac } = require('crypto');
const md5 = require('md5');
const app = express();

app.use(bodyParser.json({
	verify: function(req, res, buf, encoding) {
		req.buffer = buf;
	}
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

//var settingsFile = process.argv[1].replace(/\/[^\/]+$/, "/settings.json");
var settings = require('./settings.json');
var services = new Services(settings);

// in case a webhook api call is missed, or if queue items become available to be processed (ex: the ones that were delayed), the jobs count cash is refreshed, and new jobs are started as needed
function refresh() {
	return new Promise(function (fulfill, reject){
		services.getQueueDetails()
			.then(services.getProcessDetails.bind(services))
			.then(services.startProcessingJobs.bind(services))
			.then(fulfill)
			.catch(reject);

	});
}

function init() {
	// get the number of jobs currently running or pending for all services
	services.getProcessDetails()
		.then(services.getQueueDetails.bind(services))
		.then(function() {
			const server = app.listen(process.env.PORT || 8080, "0.0.0.0", function() {
				const port = server.address().port;
				console.log(`Listening on port ${port}!`)
			});
			services.startProcessingJobs();
			setInterval(refresh, settings.refreshInterval*1000);
		})
		.catch(function(err) {
			console.log(err);
		});
}

// checks signature to authenticate the caller (UiPath)
function checkSecretKey(signature, buffer) {
	return createHmac('sha256', settings.secretKey).update(buffer).digest('base64') === signature;
}

// checks signature to authenticate the caller (UiPath)
function checkBasicSecretKey(signature) {
	return md5(settings.secretKey) == signature;
}

app.get('/', function(req, res) {
	res.send('Hello World!');
});

app.post('/webhooks/jobs/created', function(req, res) {
	if (!checkSecretKey(req.headers['x-uipath-signature'], req.buffer)) {
		console.log("Wrong signature!");
		res.status(401).send();
		return;
	}

	req.body.Jobs.forEach(function(job) {
		services.onJobCreated(job.ReleaseName);
	});
	res.send();
});

app.post('/webhooks/jobs/finished', function(req, res) {
	if (!checkSecretKey(req.headers['x-uipath-signature'], req.buffer)) {
		console.log("Wrong signature!");
		res.status(401).send();
		return;
	}
	services.onJobFinished(req.body.Job);

	res.send();
});

app.post('/webhooks/queues/items/created', function(req, res) {
	if (!checkSecretKey(req.headers['x-uipath-signature'], req.buffer)) {
		console.log("Wrong signature!");
		res.status(401).send();
		return;
	}

	req.body.QueueItems.forEach(function(queueItem) {
		services.startJobForQueue(queueItem.QueueDefinitionId, 1);
	});

	res.send();
});

app.post('/webhooks/queues/items/completed', function(req, res) {
	if (!checkSecretKey(req.headers['x-uipath-signature'], req.buffer)) {
		console.log("Wrong signature!");
		res.status(401).send();
		return;
	}

	services.checkQueueLinks(req.body.QueueItem);

	res.send();
});

app.post('/webhooks/jobs/start', function(req, res) {
	if (!checkBasicSecretKey(req.body.secret)) {
		console.log("Wrong signature!");
		res.status(401).send();
		return;
	}
	services.startJob(req.body.processName, req.body.envName, 1, req.body.processArgs);
	res.status(200).send("Request sent");
	return;
});

app.all('*', function(req, res) {
	console.log(req.method + " " + req.originalUrl);
	console.log(req.body);
	console.log(req.headers);
	res.status(404).send('Hmm... are you trying to hack me?');
});

init();
