// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

var https = require('https');
var fs = require('fs');
var url = require('url');
var k8s = require('@kubernetes/client-node');
var formidable = require('formidable');
var express = require("express");

const port = 443;
const defaultNamespace = "default";
const configEnvKey = 'KUBECONFIG';
const summaryUrl = "/summary/summary.html";
var userInputNamespace = "phippyandfriends";

var kc = new k8s.KubeConfig();
kc.loadFromFile("C:\\git\\rbk8skubconfig")
var k8sCoreApi = kc.makeApiClient(k8s.Core_v1Api);
var k8sAppApiClient = kc.makeApiClient(k8s.Apps_v1Api);

const getNamespaces = (namespace, pretty) => {
    return k8sCoreApi && k8sCoreApi.listNamespace(pretty);
};
const getNamespacedPods = (namespace, pretty, labelFilter) => {
    return k8sCoreApi && k8sCoreApi.listNamespacedPod(namespace, pretty, undefined, undefined, undefined, labelFilter || "");
};
const getServices = (namespace, pretty) => {
    return k8sCoreApi && k8sCoreApi.listNamespacedService(namespace, pretty);
};
const getDeployments = (namespace, pretty) => {
    return k8sAppApiClient && k8sAppApiClient.listNamespacedDeployment(namespace, pretty);
};
const getReplicaSets = (namespace, pretty) => {
    return k8sAppApiClient && k8sAppApiClient.listNamespacedReplicaSet(namespace, pretty);
};
const getDaemonSets = (namespace, pretty) => {
    return k8sAppApiClient && k8sAppApiClient.listNamespacedDaemonSet(namespace, pretty);
};
const getStatefulSets = (namespace, pretty) => {
    return k8sAppApiClient && k8sAppApiClient.listNamespacedStatefulSet(namespace, pretty);
};
const readNamespacePodLog = (namespace, pretty, podName, podContainerName) => {
    const tailLines = 500;
    return k8sCoreApi && k8sCoreApi.readNamespacedPodLog(podName, namespace, podContainerName, undefined, undefined, pretty, undefined, undefined, tailLines, undefined);
};

var app = express();
app.use(express.static('dest'));

console.log('Address to use for browsing: http://localhost:' + port);
app.get('/', function (req, res) {
    res.redirect('/summary');
});

app.get('/clusterName', function (req, res) {
    var kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    var outputRes = JSON.stringify({
        clusterName: kc.getCurrentCluster().name
    });
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': outputRes.length
    });
    res.write(outputRes);
    res.end();
});

app.get('/summary', function (req, res) {
    var {
        requestUrl,
        namespaceComputed
    } = getUserInput(req);
    userInputNamespace = namespaceComputed;
    res.sendFile(__dirname + summaryUrl);
});

app.get('/getpods', function (req, res) {
    processCommands(req, res, getNamespacedPods);
});

app.get('/getservices', function (req, res) {
    processCommands(req, res, getServices);
});

app.get('/getnamespaces', function (req, res) {
    processCommands(req, res, getNamespaces);
});

app.get('/getdeployments', function (req, res) {
    processCommands(req, res, getDeployments);
});

app.get('/getreplicasets', function (req, res) {
    processCommands(req, res, getReplicaSets);
});

app.get('/getdaemonsets', function (req, res) {
    processCommands(req, res, getDaemonSets);
});

app.get('/getstatefulsets', function (req, res) {
    processCommands(req, res, getStatefulSets);
});

app.get("/getpodlog", function (req, res) {
    processCommands(req, res, readNamespacePodLog, "text/plain");
});

app.get("/logout", function (req, res) {
    var kubConfig = process.env[configEnvKey];
    k8sCoreApi = undefined;
    k8sAppApiClient = undefined;
    process.env[configEnvKey] = "";
    userInputNamespace = defaultNamespace;
    if (kubConfig && fs.existsSync(kubConfig)) {
        fs.unlinkSync(kubConfig);
    }

    res.redirect("/login");
});

app.use(function (req, res, next) {
    var {
        requestUrl,
        namespaceComputed
    } = getUserInput(req);
    if (requestUrl) {
        userInputNamespace = namespaceComputed;
        var fileName = "/summary" + requestUrl;
        if (fs.existsSync(__dirname + fileName)) {
            res.sendFile(__dirname + fileName);
        } else {
            res.sendFile(__dirname + requestUrl);
        }
    }
});

function processCommands(req, res, command, contentType = "application/json") {
    var {
        requestUrl,
        namespaceComputed
    } = getUserInput(req);
    userInputNamespace = namespaceComputed;
    if (userInputNamespace && command) {
        var selector = getQueryParameterValue(req, "labelselector");
        var podName = getQueryParameterValue(req, "podName");
        var podContainerName = getQueryParameterValue(req, "podContainerName");
        var promise = selector ?
            command(userInputNamespace, "false", selector) :
            podName ? command(userInputNamespace, "false", podName, podContainerName || "") : command(userInputNamespace, "false");
        if (promise) {
            promise.then(function (result) {
                    const resultBody = result.body || "";
                    const outputRes = (typeof resultBody == "string") ? resultBody : JSON.stringify(resultBody);
                    res.writeHead(result.response.statusCode, {
                        'Content-Type': contentType || "application/json",
                        'Content-Length': outputRes.length
                    });
                    res.write(outputRes);
                    res.end();
                })
                .catch(function (error) {
                    var errorMessage = error && error.message || error && error.body && error.body.message || error || "";
                    errorMessage = (typeof errorMessage == "string") ? errorMessage : JSON.stringify(errorMessage);
                    if (errorMessage) {
                        res.writeHead(404, {
                            'Content-Type': 'text/plain',
                            'Content-Length': errorMessage.length
                        });
                        res.write(errorMessage);
                        res.end();
                    }
                });
            return true;
        } else {
            userInputNamespace = defaultNamespace;
            res.sendFile(__dirname + loginPageUrl);
        }
    }

    return false;
}

function isUserLogRequired(req) {
    return process.env[configEnvKey] ? false : true;
}

function getUserInput(req) {
    var urlObject = url.parse(req.url, true);
    var requestUrl = urlObject.pathname.toLowerCase();
    var namespaceComputed = urlObject.query["namespace"] || userInputNamespace || defaultNamespace;
    console.log('getUserInput requestUrl:' + requestUrl + ' namespace: ' + namespaceComputed);
    return {
        requestUrl: requestUrl,
        namespaceComputed: namespaceComputed
    };
}

function getQueryParameterValue(req, paramName) {
    var urlObject = url.parse(req.url, true);
    var requestUrl = urlObject.pathname.toLowerCase();
    var paramValue = urlObject.query[paramName];
    if (paramValue) {
        return decodeURIComponent(paramValue);
    }

    return undefined;
}

exports.listen = function () {
    app.listen.apply(app, arguments);
};

exports.close = function (callback) {
    app.close(callback);
};

var privateKey  = fs.readFileSync('keys/privatekey.pem', 'utf8');
var certificate = fs.readFileSync('keys/certificate.pem', 'utf8');
var credentials = {key: privateKey, cert: certificate};
var httpsServer = https.createServer(credentials, app);
httpsServer.listen(port);