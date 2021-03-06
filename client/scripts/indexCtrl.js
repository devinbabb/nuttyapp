/*
 * Copyright (c) 2014 krishna.srinivas@gmail.com All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

gKeys = [];

angular.module('nuttyapp')
    .controller('indexCtrl', ['$scope', '$modal', '$location', 'NuttySession', 'ssh', 'Compatibility', '$location', 'sshext',
        function($scope, $modal, $location, NuttySession, ssh, Compatibility, $location, sshext) {
            ga('send', 'pageview', 'home');
            var pvtkey = undefined;
            var notmobile = !Compatibility.ismobile;
            var nuttyio = $location.host() === 'nutty.io' || $location.host() === 'www.nutty.io';

            $scope.hostport = "localhost";

            if (nuttyio) {
                if ($location.protocol() === 'http')
                    window.location.protocol = 'https';
            }

            $scope.creds = {
                password: ''
            };
            $scope.Compatibility = Compatibility;
            if (notmobile) {
                indexed('hosts').create(function(){});
                indexed('hosts').find(function(err, data) {
                    $scope.servers = data;
                    safeApply($scope);
                });
            }

            function connect(host, port, username, password, pkey) {
                var paramikojsPkey;
                if (pkey) {
                    try {
                        paramikojsPkey = new paramikojs.RSAKey(null, null, 1, null, null, null);
                    } catch(ex) {
                        try {
                            paramikojsPkey = new paramikojs.DSSKey(null, null, 1, null, null, null);
                        } catch (ex) {
                            alert("Neither RSA nor DSA key?");
                            console.log("Neither RSA nor DSA key?");
                            console.log(ex);
                            $scope.loginerrshow = "Invalid RSA or DSA key";
                            return;
                        }
                    }
                }
                if (nuttyio) {
                    ssh.connect(host, port, username, password, paramikojsPkey, function(err) {
                        Meteor._reload.onMigrate("onMigrate", function() {
                            return [false];
                        });
                        $location.path('/share');
                        $scope.$apply();
                    });
                } else {
                    sshext.connect(host, port, username, password, paramikojsPkey, function(err) {
                        Meteor._reload.onMigrate("onMigrate", function() {
                            return [false];
                        });
                        $location.path('/share');
                        $scope.$apply();
                    });
                }
                modalInstance = $modal.open({
                    templateUrl: 'templates/connectmodal.html',
                    controller: ['$scope', '$modalInstance', 'sshstate',
                    function($scope, $modalInstance, sshstate) {
                        $scope.sshstate = sshstate;
                        $scope.spinshow = function() {
                            if (sshstate.state === "authfailure" || sshstate.state === 'disconnected')
                                return false;
                            else
                                return true;
                        }
                        $scope.$watch('sshstate.state', function(newValue, oldValue) {
                            if (newValue === 'authsuccess') {
                                setTimeout(function() {
                                    $modalInstance.close();
                                }, 0);
                            }
                            console.log(sshstate.error);
                        });
                    }]});
            }

            $scope.sshhostporterr = function() {
                var host, port;
                if ($scope.hostport && $scope.hostport.match(/:/)) {
                    host = $scope.hostport.match(/(.*):(.*)/)[1];
                    port = parseInt($scope.hostport.match(/(.*):(.*)/)[2]);
                    if (!host || !port)
                        return "has-error";
                }
                return "";
            }

            $scope.usernameerr = function() {
                return "";
            }

            $scope.loginerrclose = function() {
                $scope.loginerrshow = "";
            }

            function loginformerr() {
                var host, port;
                if ($scope.hostport && $scope.hostport.match(/:/)) {
                    host = $scope.hostport.match(/(.*):(.*)/)[1];
                    port = parseInt($scope.hostport.match(/(.*):(.*)/)[2]);
                }
                if (!host)
                    host = $scope.hostport;
                if (!port)
                    port = 22;
                if (!host || !port) {
                    return "Incorrect SshHost entry";
                }
                if (!$scope.username) {
                    return "username required";
                }
                if (!$scope.creds.password && !pvtkey) {
                    return "password or pvtkey required";
                }
                return "";
            }

            $scope.submit = function() {
                if (!ssh.appinstalled && !sshext.appinstalled) {
                    alert("Nutty not installed");
                    return;
                }
                var host, port;
                if (!$scope.hostport) {
                    $scope.hostport = "localhost";
                }
                if ($scope.hostport && $scope.hostport.match(/:/)) {
                    host = $scope.hostport.match(/(.*):(.*)/)[1];
                    port = parseInt($scope.hostport.match(/(.*):(.*)/)[2]);
                }
                if (!host)
                    host = $scope.hostport;
                if (!port)
                    port = 22;
                $scope.loginerrshow = loginformerr();
                if ($scope.loginerrshow)
                    return;
                connect(host, port, $scope.username, $scope.creds.password, pvtkey);
            }

            $scope.readpvtkey = function() {
                var reader = new FileReader();
                reader.onload = function(e) {
                    gKeys[1] = e.target.result;
                    // pvtkey = new paramikojs.RSAKey(null, null, 1, null, null, null);
                    pvtkey = e.target.result;
                }
                reader.readAsText($('#pvtkey')[0].files[0]);
            }

            $scope.currentuser = function() {
                var user = Meteor.user();
                if (user) {
                    return user.username;
                } else {
                    return "";
                }
            };

            $scope.save = function() {
                var host, port;
                if (!$scope.hostport) {
                    $scope.hostport = "localhost";
                }
                if ($scope.hostport && $scope.hostport.match(/:/)) {
                    host = $scope.hostport.match(/(.*):(.*)/)[1];
                    port = parseInt($scope.hostport.match(/(.*):(.*)/)[2]);
                }
                if (!host)
                    host = $scope.hostport;
                if (!port)
                    port = 22;
                $scope.loginerrshow = loginformerr();
                if ($scope.loginerrshow)
                    return;

                var hostobj = {
                    host: host,
                    port: port,
                    username: $scope.username,
                    password: $scope.creds.password,
                    pvtkey: pvtkey
                }
                if (notmobile) {
                    indexed('hosts').insert(hostobj, function(){
                        indexed('hosts').find(function(err, data) {
                            $scope.servers = data;
                            $scope.$apply();
                        });
                    });
                }
            }
            $scope.serverdelete = function(id) {
                if (notmobile) {
                    indexed('hosts').delete({
                        _id: id
                    }, function(err, data) {
                        indexed('hosts').find(function(err, data) {
                            $scope.servers = data;
                            $scope.$apply();
                        });
                    });
                }
            }
            $scope.serverconnect = function(server) {
                if (ssh.appinstalled || sshext.appinstalled) {
                    gKeys[1] = server.pvtkey;
                    connect(server.host, server.port, server.username, server.password, server.pvtkey);
                } else {
                    alert("Click 'Install Nutty'");
                }
            }
            $scope.demo = function() {
                var modalInstance = $modal.open({
                    templateUrl: 'templates/demo.html',
                });
            }
            $scope.disabled = function() {
                if (ssh.appinstalled || sshext.appinstalled)
                    return "";
                else
                    return "disabled";
            }
            $scope.nuttyio_install_visible = function() {
                if ($location.host() !== 'nutty.io' && $location.host() !== 'www.nutty.io') {
                    return false;
                }
                if (ssh.appinstalled)
                    return false;
                else
                    return true;
            }
            $scope.nonnuttyio_install_visible = function() {
                if ($location.host() !== 'nutty.io' && $location.host() !== 'www.nutty.io') {
                    return true;
                } else
                    return false;
            }
            $scope.addtochrome = function() {
                    if (Compatibility.browser.incompatible) {
                        alert("Supported on Chrome. Firefox support coming soon!");
                        return;
                    }
                    chrome.webstore.install("https://chrome.google.com/webstore/detail/jeiifmbcmlhfgncnihbiicdbhnbagmnk",
                    function() {
                        mixpanel.track("installsuccess");
                        window.location.pathname = "/";
                    }, function() {
                        mixpanel.track("installfail");
                        alert("Nutty install failed.");
                    });
            }
        }
    ]);


angular.module('nuttyapp')
    .controller('faqCtrl', ['$scope', '$location', '$anchorScroll',
        function($scope, $location, $anchorScroll) {
            ga('send', 'pageview', 'faq');
            $scope.currentuser = function() {
                var user = Meteor.user();
                if (user) {
                    return user.username;
                } else {
                    return "";
                }
            };
            $scope.scrollto = function(id) {
                $location.hash(id);
                $anchorScroll();
            }
        }]);
