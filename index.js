let exec = require('child_process').exec;
let Service, Characteristic, Homebridge, Accessory;

const PLUGIN_NAME 	= 'homebridge-adb';
const PLATFORM_NAME = 'HomebridgeADB';
const LIMIT_RETRY 	= 5;

const OTHER_APP_ID = "other";
const HOME_APP_ID = "home";

module.exports = (homebridge) => {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Homebridge = homebridge;
	Accessory = homebridge.platformAccessory;
	homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ADBPluginPlatform, true);
};


class ADBPlugin {
	constructor(log, config, api) {
		if(!config) return;

		this.log = log;
		this.config = config;
		this.api = api;

		// Configuration
		// Name
		this.name = this.config.name || 'Android Device';
		// IP
		this.ip = this.config.ip;
		if(!this.ip) {
			this.log.error("\nPlease provide IP for this accessory: ${this.name}\n");
			return;
		}
		// Interval
		this.interval = this.config.interval || 5000;
		// Can't be lower than 300 miliseconds, it will flood your network
		if(this.interval < 300) this.interval = 300;
		// Inputs
		this.inputs = this.config.inputs;
		if(!this.inputs) this.inputs = [];
		this.inputs.unshift({ "name": "Home", "id": HOME_APP_ID });
		this.inputs.push({ "name": "Other", "id": OTHER_APP_ID });
		// Sensor
		this.playbacksensor =  this.config.playbacksensor;
		// Category
		this.category = "TELEVISION";
		if(this.config.category) this.category = this.config.category.toUpperCase();
		this.isSpeaker = function() {
			// if(this.category == "SPEAKER" || this.category == "AUDIO_RECEIVER") return true;
			// else return false;

			return false;
		}

		// Variable
		this.awake = false;
		this.playing = false;
		this.currentInputIndex = 0;
		this.currentAppOnProgress = false;
		this.checkPowerOnProgress = false;
		this.checkPlaybackProgress = false;
		this.prevStdout = "";
		this.limit_retry = LIMIT_RETRY;


		/**
		 * Create the accessory
		 */

		// generate a UUID
		const uuid = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name);
		const uuidos = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name + "OccupancySensor");

		// create the external accessory
		this.device = new this.api.platformAccessory(this.name, uuid);

		// set the external accessory category
		if(this.category == "SPEAKER")
			this.device.category = this.api.hap.Categories.SPEAKER;
		else if(this.category == "TV_STREAMING_STICK")
			this.device.category = this.api.hap.Categories.TV_STREAMING_STICK;
		else if(this.category == "TV_SET_TOP_BOX")
			this.device.category = this.api.hap.Categories.TV_SET_TOP_BOX;
		else if(this.category == "AUDIO_RECEIVER")
			this.device.category = this.api.hap.Categories.AUDIO_RECEIVER;
		else if(this.category == "APPLE_TV")
			this.device.category = this.api.hap.Categories.APPLE_TV;
		else
			this.device.category = this.api.hap.Categories.TELEVISION;

		// add the device service
		if(this.isSpeaker())
			this.deviceService = this.device.addService(Service.SmartSpeaker);
		else
			this.deviceService = this.device.addService(Service.Television);

		// get device information
		this.deviceInfo = this.device.getService(Service.AccessoryInformation);

		// set device service name
		this.deviceService.setCharacteristic(Characteristic.ConfiguredName, this.name);
		if(!this.isSpeaker()) this.deviceService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		// Handle volume and media
		// this.handleVolume();
		// this.handleMediaStatus();
		// this.handleMediaStates();

		if(!this.isSpeaker()) {
			// Handle input
			this.handleOnOff();
			this.handleInput();

			// Show Control Center Remote if needed
			this.handleRemoteControl();

			// Create additional services
			this.createInputs();
			this.createTelevisionSpeakers();
		}

		// add playback sensor
		if(this.playbacksensor) {
			this.devicePlaybackSensor = new this.api.platformAccessory(this.name + " Playback Sensor", uuidos);
			this.devicePlaybackSensor.category = this.api.hap.Categories.SENSOR;
			this.devicePlaybackSensorInfo = this.devicePlaybackSensor.getService(Service.AccessoryInformation);
			this.devicePlaybackSensorService = this.devicePlaybackSensor.addService(Service.MotionSensor);
			this.handleMediaAsSensor();
		}

		/**
		 * Publish as external accessory
		 * Check ADB connection before publishing the accesory
		 */

		this.connect(() => {
			var adbCommand = `adb -s ${this.ip} shell "getprop ro.product.model && getprop ro.product.manufacturer && getprop ro.serialno"`;

			// get the accesory information and send it to HB
			exec(adbCommand, (err, stdout, stderr) => {
				if(err) {
					var message = "";

					if(stderr.includes('device still authorizing')) message = 'Device still authorizing.';
					else if(stderr.includes('device unauthorized.')) message = 'Device unauthorized.';
					else message = 'Can\'t get device information.';

					this.log.info(this.name, ` - ${message} You can ignore this message. But if problem occurred with your device, please restart your homebridge server.`);
				}

				stdout = stdout.split("\n");

				// Publish the accessories
				this.deviceInfo
					.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
					.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Google")
					.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);
				this.api.publishExternalAccessories(PLUGIN_NAME, [this.device]);
				this.log.info(this.name, `- Created`);

				// Publish additional sensor accesories
				if(this.playbacksensor) {
					this.devicePlaybackSensorInfo
						.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
						.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Google")
						.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);
					this.api.publishExternalAccessories(PLUGIN_NAME, [this.devicePlaybackSensor]);
					this.log.info(this.name, `- Sensor created`);
				}
			});

			// Loop the power status
			this.update();
		});
	}

	createInputs() {
		/**
		 * Create Device Input Source Services
		 * These are the inputs the user can select from.
		 * When a user selected an input the corresponding Identifier Characteristic
		 * is sent to the device Service ActiveIdentifier Characteristic handler.

		 * This plugins will create 50 inputs (- current inputs) unconfigured
		 * and hidden input for future modification. Home app seems have problem
		 * to add new input after initial add of the accessory. The newly
		 * created inputs will shown up as related accesorries instead of
		 * input accessories
		**/

		for (let i = 0; i < 50; i++) {
			let
				input = this.inputs[i],
				type = Characteristic.InputSourceType.APPLICATION,
				configured = Characteristic.IsConfigured.CONFIGURED,
				targetVisibility = Characteristic.TargetVisibilityState.SHOWN,
				currentVisibility = Characteristic.CurrentVisibilityState.SHOWN,
				name = "";

			if(i == 0) type = Characteristic.InputSourceType.HOME_SCREEN;
			else if(i == this.inputs.length - 1) type = Characteristic.InputSourceType.OTHER;

			let humanNumber = i + 1;
			if(humanNumber < 10) humanNumber = "0" + (i + 1);

			if(i >= this.inputs.length) {
				// Create hidden input for future modification
				configured = Characteristic.IsConfigured.NOT_CONFIGURED;
				targetVisibility = Characteristic.TargetVisibilityState.HIDDEN;
				currentVisibility = Characteristic.CurrentVisibilityState.HIDDEN;
				name = `${humanNumber}. Hidden Input`;
			} else {
				name = `${humanNumber}. ${input.name}`;
			}

			// this.log.info(this.name, name, targetVisibility, currentVisibility);
			let service = this.device.addService(Service.InputSource, `Input - ${name}`, i);
			service
				.setCharacteristic(Characteristic.Identifier, i)
				.setCharacteristic(Characteristic.ConfiguredName, name)
				.setCharacteristic(Characteristic.InputSourceType, type)
				.setCharacteristic(Characteristic.TargetVisibilityState, targetVisibility)
				.setCharacteristic(Characteristic.CurrentVisibilityState, currentVisibility)
				.setCharacteristic(Characteristic.IsConfigured, configured);
			this.deviceService.addLinkedService(service);

			if(configured == Characteristic.IsConfigured.CONFIGURED) {
				this.inputs[i].service = service;
			}
		};
	}

	createTelevisionSpeakers() {
		/**
		 * Create a speaker service to allow volume control
		 */

		this.deviceTelevisionSpeakerService = this.device.addService(Service.TelevisionSpeaker);

		this.deviceTelevisionSpeakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			// .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE);

		// handle [volume control]
		this.deviceTelevisionSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
			.on('set', (state, callback) => {
				var key = "";

				if(state) key = "KEYCODE_VOLUME_DOWN";
				else key = "KEYCODE_VOLUME_UP";

				exec(`adb -s ${this.ip} shell "input keyevent ${key}"`, (err, stdout, stderr) => {
					if(err) this.log.info(this.name, '- Can\'t set volume');
				});

				callback(null);
			});

		// handle [mute control] - not implemented yet
		this.deviceTelevisionSpeakerService.getCharacteristic(Characteristic.Mute)
			.on('get', (callback) => {
				callback(null, 0);
			})
			.on('set', (state, callback) => {
				callback(null, state);
			});

		this.deviceService.addLinkedService(this.deviceTelevisionSpeakerService);
	}

	handleOnOff() {
		// handle [on / off]
		this.deviceService.getCharacteristic(Characteristic.Active)
			.on('set', (state, callback) => {
				exec(`adb connect ${this.ip}`, (err, stdout, stderr) => {
					if(!err) {
						if(state) {
							// When it sleep, wake it up
							exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_WAKEUP"`, (err, stdout, stderr) => {
								if(err) this.log.info(this.name, "- Can't make device wakeup, or it's already awake");
								else this.log.info(this.name, "- Awake");

								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							});
						} else {
							exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_SLEEP"`, (err, stdout, stderr) => {
								if(err) this.log.info(this.name, "- Can't make device sleep, or it's already sleep");
								else this.log.info(this.name, "- Sleeping");

								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							});
						}
					} else {
						this.log.info(this.name, "- Device not responding");
					}
				});

				callback(null);
			}).on('get', (callback) => {
				this.checkPowerOnProgress = false;
				this.checkPower(() => {
					this.deviceService.setCharacteristic(Characteristic.Active, this.awake);
				});

				callback(null, this.awake);
			});
	}

	handleInput() {
		// handle [input source]
		this.deviceService.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('set', (state, callback) => {
				if(!this.currentAppOnProgress) {
					this.currentAppOnProgress = true;

					exec(`adb connect ${this.ip}`, (err, stdout, stderr) => {
						if(!err) {
							let adb = `adb -s ${this.ip} shell "input keyevent KEYCODE_HOME"`;

							this.currentInputIndex = state;

							if(this.currentInputIndex != 0 && this.inputs[this.currentInputIndex].id != OTHER_APP_ID) {
								let type = this.inputs[this.currentInputIndex].id.trim();

								if(!type.includes(" ") && type.includes("."))
									adb = `adb -s ${this.ip} shell "monkey -p ${this.inputs[this.currentInputIndex].id} 1"`;
								else
									adb = `adb -s ${this.ip} shell "${this.inputs[this.currentInputIndex].id}"`;
							}

							exec(adb, (err, stdout, stderr) => {
								if(!err) this.log.info(this.name, "- Current app -", this.inputs[this.currentInputIndex].name);
								else  this.log.info(this.name, "- Can't open -", this.inputs[this.currentInputIndex].name);
							});
						} else {
							this.log.info(this.name, "- Device not responding");
						}

						this.currentAppOnProgress = false;
					});
				}

				callback(null);
			});
	}

	handleVolume() {
		// handle [volume]
		this.deviceService.getCharacteristic(Characteristic.Volume)
			.on('get', (callback, state) => {
				callback(null, 100);
			})
			.on('set', (state, callback) => {
				this.log.info(this.name, '- Volume: ' + state);
				callback(null);
			});
	}

	handleMediaStatus() {
		// handle [media status]
		this.deviceService.getCharacteristic(Characteristic.CurrentMediaState)
			.on('get', (callback) => {
				var state = Characteristic.CurrentMediaState.LOADING;

				exec(`adb -s ${this.ip} shell "dumpsys media_session | grep state=PlaybackState"`, (err, stdout, stderr) => {
					if(err) this.log.error(this.name, '- Can\'t get media status');
					else {
						stdout = stdout.split("\n");
						stdout = stdout[0].trim();

						if(stdout.includes("state=2, position=0")) state = Characteristic.CurrentMediaState.STOP;
						else if(stdout.includes("state=3")) state = Characteristic.CurrentMediaState.PLAY;
						else state = Characteristic.CurrentMediaState.PAUSE;
					}

					this.deviceService.setCharacteristic(Characteristic.CurrentMediaState, state);
				});

				callback(null, state);
			});
	}

	handleMediaStates() {
		// handle [media state]
		this.deviceService.getCharacteristic(Characteristic.TargetMediaState)
			.on('get', (callback) => {
				var state = Characteristic.TargetMediaState.STOP;

				exec(`adb -s ${this.ip} shell "dumpsys media_session | grep state=PlaybackState"`, (err, stdout, stderr) => {
					if(err) this.log.error(this.name, '- Can\'t get media status');
					else {
						stdout = stdout.split("\n");
						stdout = stdout[0].trim();
						if(stdout.includes("state=2, position=0")) state = Characteristic.TargetMediaState.STOP;
						else if(stdout.includes("state=3")) state = Characteristic.TargetMediaState.PLAY;
						else state = Characteristic.TargetMediaState.PAUSE;
					}

					this.deviceService.setCharacteristic(Characteristic.TargetMediaState, state);
				});

				callback(null, state);
			})
			.on('set', (state, callback) => {
				var key = "";

				switch(state) {
					case Characteristic.TargetMediaState.PLAY: {
						key = 'play';
						break;
					}
					case Characteristic.TargetMediaState.PAUSE: {
						key = 'pause';
						break;
					}
					case Characteristic.TargetMediaState.STOP:
					default: {
						key = 'stop';
						break;
					}
				}

				exec(`adb -s ${this.ip} shell "media dispatch ${key}"`, (err, stdout, stderr) => {
					if(err) this.log.error(this.name, '- Can\'t send: ' + key.toUpperCase());
					else this.log.info(this.name, '- Sending: ' + key.toUpperCase());
				});

				callback(null);
			});
	}

	handleMediaAsSensor() {
		var that = this;

		// handle [media state]
		this.devicePlaybackSensorService.getCharacteristic(Characteristic.MotionDetected)
			.on('get', (callback) => {
				var state = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
				if(that.playing) state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;

				that.checkPlayback();
				callback(null, state);
			});
	}

	handleRemoteControl() {
		// handle [remote control]
		this.deviceService.getCharacteristic(Characteristic.RemoteKey)
			.on('set', (state, callback) => {
				var key = "";

				switch(state) {
					case Characteristic.RemoteKey.REWIND: {
						key = 'KEYCODE_MEDIA_REWIND';
						break;
					}
					case Characteristic.RemoteKey.FAST_FORWARD: {
						key = 'KEYCODE_MEDIA_FAST_FORWARD';
						break;
					}
					case Characteristic.RemoteKey.NEXT_TRACK: {
						key = 'KEYCODE_MEDIA_NEXT';
						break;
					}
					case Characteristic.RemoteKey.PREVIOUS_TRACK: {
						key = 'KEYCODE_MEDIA_PREVIOUS';
						break;
					}
					case Characteristic.RemoteKey.ARROW_UP: {
						key = 'KEYCODE_DPAD_UP';
						break;
					}
					case Characteristic.RemoteKey.ARROW_DOWN: {
						key = 'KEYCODE_DPAD_DOWN';
						break;
					}
					case Characteristic.RemoteKey.ARROW_LEFT: {
						key = 'KEYCODE_DPAD_LEFT';
						break;
					}
					case Characteristic.RemoteKey.ARROW_RIGHT: {
						key = 'KEYCODE_DPAD_RIGHT';
						break;
					}
					case Characteristic.RemoteKey.SELECT: {
						key = 'KEYCODE_ENTER';
						break;
					}
					case Characteristic.RemoteKey.BACK: {
						if(this.config.backbutton) key = this.config.backbutton;
						else key = 'KEYCODE_BACK';
						break;
					}
					case Characteristic.RemoteKey.EXIT: {
						key = 'KEYCODE_HOME';
						break;
					}
					case Characteristic.RemoteKey.PLAY_PAUSE: {
						if(this.config.playpausebutton) key = this.config.playpausebutton;
						else key = 'KEYCODE_MEDIA_PLAY_PAUSE';
						break;
					}
					case Characteristic.RemoteKey.INFORMATION: {
						if(this.config.infobutton) key = this.config.infobutton;
						else key = 'KEYCODE_INFO';
						break;
					}
				}

				exec(`adb -s ${this.ip} shell "input keyevent ${key}"`, (err, stdout, stderr) => {
					if(err) this.log.error(this.name, '- Can\'t send: ' + key);
				});
				callback(null);
			});
	}

	checkPlayback() {
		var state = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;

		if(!this.awake) {
			// When device is asleep, set the sensor off
			this.devicePlaybackSensorService.setCharacteristic(Characteristic.MotionDetected, state);
		} else if(!this.checkPlaybackProgress) {
			this.checkPlaybackProgress = true;
			exec(`adb -s ${this.ip} shell "dumpsys media_session | grep state=PlaybackState"`, (err, stdout, stderr) => {
				if(err) this.log.info(this.name, '- Can\'t get media status');
				else {
					stdout = stdout.split("\n");
					if(stdout[0]) stdout = stdout[0].trim();
					else stdout = "";

					if(stdout.includes("state=3")) {
						state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
						if(!this.playing) {
							this.log.info(this.name, '- Playback start');
							this.playing = true;
						}
					} else if(this.playing) {
						this.log.info(this.name, '- Playback stop');
						this.playing = false;
					}
				}

				this.devicePlaybackSensorService.setCharacteristic(Characteristic.MotionDetected, state);
				this.checkPlaybackProgress = false;
			});
		}
	}

	checkPower(callback) {
		if(!this.checkPowerOnProgress) {
			this.checkPowerOnProgress = true;

			this.dumpsys((error, stdout) => {
				if(!error) {
					var output = stdout.trim();

					if((output == 'true' && !this.awake) || (output == 'false' && this.awake)) {
						this.awake = !this.awake;
						if(!this.isSpeaker()) this.deviceService.getCharacteristic(Characteristic.Active).updateValue(this.awake);
					}

					if(callback) callback(this.awake);
				} else {
					if(callback) callback('error');
				}

				this.checkPowerOnProgress = false;
			});
		}
	}

	checkInput(error, value, appId) {
		if(!this.currentAppOnProgress) {
			this.currentAppOnProgress = true;

			exec(`adb -s ${this.ip} shell "dumpsys window windows | grep -E mFocusedApp"`, (err, stdout, stderr) => {
				if(!err) {
					if(!stdout) stdout = "";
					stdout = stdout.trim();

					if(stdout != this.prevStdout) {
						let otherApp = true;

						// Identified current focused app
						this.prevStdout = stdout;
						if(stdout) {
							stdout = stdout.split("/");
							stdout[0] = stdout[0].split(" ");
							stdout[0] = stdout[0][4];

							if(stdout[0] == undefined) stdout[0] = HOME_APP_ID;
							if(stdout[1] == undefined) stdout[1] = "";

							if(stdout[1].includes("Launcher") || stdout[1].substr(0, 13) == ".MainActivity" || stdout[1].includes("RecentsTvActivity")) stdout = this.inputs[0].id;
							else stdout = stdout[0];
						} else stdout = OTHER_APP_ID;

						if(this.inputs[this.currentInputIndex].id != stdout && (stdout === HOME_APP_ID || this.inputs[this.currentInputIndex].type !== 'command')) {
							this.inputs.forEach((input, i) => {
								// Home or registered app
								if(stdout == input.id) {
									this.currentInputIndex = i;
									otherApp = false;
								}
							});

							// Other app
							if(otherApp) {
								let name = stdout.split("."),
									humanName = "",
									i = 0;

								// Extract human readable name from app package name
								while(name[i]) {
									name[i] = name[i].charAt(0).toUpperCase() + name[i].slice(1);
									if(i > 0)
										if(name[i] != "Com" && name[i] != "Android")
											if(name[i] == "Vending") humanName += "Play Store";
											else if(name[i] == "Gm") humanName += "GMail";
											else humanName += (" " + name[i]);
									i++;
								}
								humanName = humanName.trim();
								if(humanName != "Other") humanName = `Other (${humanName.trim()})`;

								this.currentInputIndex = this.inputs.length - 1;
								if(this.inputs[this.currentInputIndex]) this.inputs[this.currentInputIndex].id = stdout;
								if(this.inputs[this.currentInputIndex].service) this.inputs[this.currentInputIndex].service.setCharacteristic(Characteristic.ConfiguredName, `${this.currentInputIndex + 1}. ${humanName}`);
							}

							this.deviceService.updateCharacteristic(Characteristic.ActiveIdentifier, this.currentInputIndex);
							this.log.info(this.name, "- Current app -", stdout);
						}
					}
				}

				this.currentAppOnProgress = false;
			});
		}
	}

	connect(callback) {
		var that = this;
		var error = function() {
			that.log.info(`${that.name} - Device disconnected? Trying to reconnect.`);
		}

		exec(`adb disconnect ${this.ip}`, (err, stdout, stderr) => {
			if(err) error();
			else {
				exec(`adb connect ${this.ip}`, (err, stdout, stderr) => {
					if(err) error();
					else if(callback) callback();
				});
			}
		});
	}

	update() {
		var that = this;

		// Update device status every second -> or based on configuration
		this.intervalHandler = setInterval(() => {
			that.checkPower(function(result) {
				if(result == 'error') {
					that.connect();
				} else {
					if(that.awake && !that.isSpeaker()) that.checkInput();
				}
			});

			if(this.playbacksensor) {
				that.checkPlayback();
			}
		}, this.interval);
	}

	dumpsys(callback) {
		var that = this;
		var adbCommand = `adb -s ${this.ip} shell "dumpsys power | grep mHoldingDisplay"`;

		exec(adbCommand, (err, stdout, stderr) => {
			if(err) {
				if(that.limit_retry > 0) {
					that.limit_retry--;
					callback(true, 'false');
				} else if (that.limit_retry == 0){
					that.log.info(that.name, "- Device disconnected. Please turn on your device manually.");
					that.limit_retry--;
					callback(false, 'false');
				}
			} else {
				if(that.limit_retry < 0) {
					that.limit_retry = LIMIT_RETRY;
					that.log.info(that.name, "- Connected.");
				}

				stdout = stdout.trim().split('=')[1];
				callback(false, stdout);
			}
		});
	}
}


class ADBPluginPlatform {
	constructor(log, config, api) {
		if(!config) return;

		this.log = log;
		this.api = api;
		this.config = config;

		if(this.api) this.api.on('didFinishLaunching', this.initAccessory.bind(this));
	}

	initAccessory() {
		// read from config.accessories
		if(this.config.accessories && Array.isArray(this.config.accessories)) {
			for (let accessory of this.config.accessories) {
				if(accessory) new ADBPlugin(this.log, accessory, this.api);
			}
		} else if(this.config.accessories) {
			this.log.info('Cannot initialize. Type: %s', typeof this.config.accessories);
		}

		if(!this.config.accessories) {
			this.log.info('-------------------------------------------------');
			this.log.info('Please add one or more accessories in your config');
			this.log.info('-------------------------------------------------');
		}
	}
}