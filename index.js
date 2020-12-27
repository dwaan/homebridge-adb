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
			this.log.error("\n\nPlease provide IP for this accessory: ${this.name}\n\n");
			return;
		}
		this.log.info(`Creating: ${this.name}`);
		// Interval
		this.interval = this.config.interval || 5000;
		// Can't be lower than 300 miliseconds, it will flood your network
		if(this.interval < 300) this.interval = 300;
		// Inputs
		this.inputs = this.config.inputs;
		if(!this.inputs) this.inputs = [];
		this.inputs.unshift({ "name": "Home", "id": HOME_APP_ID });
		this.inputs.push({ "name": "Other", "id": OTHER_APP_ID });

		// Variable
		this.awake = false;
		this.currentAppIndex = 0;
		this.currentAppOnProgress = false;
		this.checkPowerOnProgress = false;
		this.limit_retry = LIMIT_RETRY;


		/**
		 * Create the accessory
		 */

		// generate a UUID
		const uuid = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name);

		// create the external accessory
		this.tv = new this.api.platformAccessory(this.name, uuid);

		// set the external accessory category
		this.tv.category = this.api.hap.Categories.TELEVISION;

		// add the tv service
		this.tvService = this.tv.addService(Service.Television);

		// get the tv information
		this.tvInfo = this.tv.getService(Service.AccessoryInformation);

		// set tv service name
		this.tvService
			.setCharacteristic(Characteristic.ConfiguredName, this.name)
			.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		// Handle input
		this.handleOnOff();
		this.handleInput();
		this.handleMediaStatus();
		this.handleMediaStates();
		this.handleRemoteControl();


		// Create additional services
		this.createInputs();
		this.createSpeakers();

		/**
		 * Publish as external accessory
		 * Check ADB connection before publishing the accesory
		 */

		this.connect(() => {
			var adbCommand = `adb -s ${this.ip} shell "getprop ro.product.model && getprop ro.product.manufacturer && getprop ro.serialno"`;
			// get the accesory information and send it to HB
			exec(adbCommand, (err, stdout, stderr) => {
				if(err) {
					this.log.info("\n\nCan't get information from", this.name);
					this.log.info("This shouldn't be a problem, but please report this output.");
					this.log.info("1. When running this command");
					this.log.info(adbCommand);
					this.log.info("2. Output:");
					this.log.info(stdout);
					this.log.info("3. Error output:");
					this.log.info(stderr, "\n\n");
				}

				stdout = stdout.split("\n");

				this.tvInfo
					.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
					.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Google")
					.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);

				// Publish the accessories
				this.api.publishExternalAccessories(PLUGIN_NAME, [this.tv]);
			});

			// Loop the power status
			this.update();
		});
	}

	createInputs() {
		/**
		 * Create TV Input Source Services
		 * These are the inputs the user can select from.
		 * When a user selected an input the corresponding Identifier Characteristic
		 * is sent to the TV Service ActiveIdentifier Characteristic handler.

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

			// this.log.info(this.ip, name, targetVisibility, currentVisibility);
			let service = this.tv.addService(Service.InputSource, `Input - ${name}`, i);
			service
				.setCharacteristic(Characteristic.Identifier, i)
				.setCharacteristic(Characteristic.ConfiguredName, name)
				.setCharacteristic(Characteristic.InputSourceType, type)
				.setCharacteristic(Characteristic.TargetVisibilityState, targetVisibility)
				.setCharacteristic(Characteristic.CurrentVisibilityState, currentVisibility)
				.setCharacteristic(Characteristic.IsConfigured, configured);
			this.tvService.addLinkedService(service);

			if(configured == Characteristic.IsConfigured.CONFIGURED) {
				this.inputs[i].service = service;
			}

		};
	}

	createSpeakers() {
		/**
		 * Create a speaker service to allow volume control
		 */

		this.tvSpeakerService = this.tv.addService(Service.TelevisionSpeaker);

		this.tvSpeakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);

		// handle [volume control]
		this.tvSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
			.on('set', (state, callback) => {
				var key = "";

				if(state) key = "KEYCODE_VOLUME_DOWN";
				else key = "KEYCODE_VOLUME_UP";

				exec(`adb -s ${this.ip} shell "input keyevent ${key}"`, (err, stdout, stderr) => {
					if(err) this.log.info(this.ip, '- Can\'t set volume');
				});

				callback(null);
			});

		// handle [mute control] - not implemented yet
		this.tvSpeakerService.getCharacteristic(Characteristic.Mute)
			.on('get', (callback) => {
				callback(null);
			})
			.on('set', (state, callback) => {
				callback(null);
			});

			this.tvService.addLinkedService(this.tvSpeakerService);
	}

	handleOnOff() {
		// handle [on / off]
		this.tvService.getCharacteristic(Characteristic.Active)
			.on('set', (state, callback) => {
				this.connect(() => {
					if(state) {
						// When it sleep, wake it up
						exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_WAKEUP"`, (err, stdout, stderr) => {
							if(err) this.log.info(this.ip, "- Can't make device wakeup, or it's already awake");
							else this.log.info(this.ip, "- Awake");

							this.tvService.updateCharacteristic(Characteristic.Active, state);
							callback(null);
						});
					} else {
						exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_SLEEP"`, (err, stdout, stderr) => {
							if(err) this.log.info(this.ip, "- Can't make device sleep, or it's already sleep");
							else this.log.info(this.ip, "- Sleeping");

							this.tvService.updateCharacteristic(Characteristic.Active, state);
							callback(null);
						});
					}
				});
			}).on('get', (callback) => {
				this.checkPowerOnProgress = false;
				this.checkPower(() => {
					callback(null, this.awake);
				});
			});
	}

	handleInput() {
		// handle [input source]
		this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('set', (state, callback) => {
				this.connect(() => {
					let adb = `adb -s ${this.ip} shell "input keyevent KEYCODE_HOME"`;

					this.currentAppIndex = state;

					if(this.currentAppIndex != 0 && this.inputs[this.currentAppIndex].id != OTHER_APP_ID) adb = `adb -s ${this.ip} shell "monkey -p ${this.inputs[this.currentAppIndex].id} 1"`;

					exec(adb, (err, stdout, stderr) => {
						if(!err) this.log.info(this.ip, "- Switched from home app -", this.inputs[this.currentAppIndex].id);
						else  this.log.info(this.ip, "- Can't switched from home app -", this.inputs[this.currentAppIndex].id);
					});

					callback(null);
				});
			});
	}

	handleMediaStatus() {
		// handle [media status] - not implemented yet
		this.tvService.getCharacteristic(Characteristic.CurrentMediaState)
			.on('set', (state, callback) => {
				if(state == Characteristic.CurrentMediaState.PLAY)
					this.log.info(this.ip, '- Accessory is playing');
				else if(state == Characteristic.CurrentMediaState.PAUSE)
					this.log.info(this.ip, '- Accessory is paused');
				else if(state == Characteristic.CurrentMediaState.STOP)
					this.log.info(this.ip, '- Accessory is stoped');
				else if(state == Characteristic.CurrentMediaState.LOADING)
					this.log.info(this.ip, '- Accessory is loading');
				else
					this.log.info(this.ip, '- Accessory is interupted');

				callback(null);
			});
	}

	handleMediaStates() {
		// handle [media state] - not implemented yet
		this.tvService.getCharacteristic(Characteristic.TargetMediaState)
			.on('get', (callback) => {
				// if(state == Characteristic.TargetMediaState.PLAY)
				// 	this.log.info(this.ip, '- Get Media: Accessory is playing');
				// else if(state == Characteristic.TargetMediaState.PAUSE)
				// 	this.log.info(this.ip, '- Get Media: Accessory is paused');
				// else
				// 	this.log.info(this.ip, '- Get Media: Accessory is stoped');

				callback(null);
			})
			.on('set', (state, callback) => {
				if(state == Characteristic.TargetMediaState.PLAY)
					this.log.info(this.ip, '- Set Media: Accessory is playing');
				else if(state == Characteristic.TargetMediaState.PAUSE)
					this.log.info(this.ip, '- Set Media: Accessory is paused');
				else
					this.log.info(this.ip, '- Set Media: Accessory is stoped');

				callback(null);
			});
	}

	handleRemoteControl() {
		// handle [remote control]
		this.tvService.getCharacteristic(Characteristic.RemoteKey)
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
					if(err) this.log.error(this.ip, '- Can\'t send: ' + key);

					callback(null);
				});
			});
	}

	checkPower(callback) {
		if(!this.checkPowerOnProgress) {
			this.checkPowerOnProgress = true;

			this.dumpsys((err, stdout, stderr) => {
				if(!err) {
					var output = stdout.trim();

					if((output == 'true' && !this.awake) || (output == 'false' && this.awake)) {
						this.awake = !this.awake;
						this.tvService.getCharacteristic(Characteristic.Active).updateValue(this.awake);
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
				let otherApp = true;
				stdout = stdout.trim();

				// Identified current focused app
				if(stdout) {
					stdout = stdout.split("/");
					stdout[0] = stdout[0].split(" ");
					stdout[0] = stdout[0][4];

					if(stdout[1].includes("Launcher") || stdout[1].substr(0, 13) == ".MainActivity" || stdout[1].includes("RecentsTvActivity")) stdout = this.inputs[0].id;
					else stdout = stdout[0];
				} else {
					stdout = OTHER_APP_ID;
				}


				if(!err && this.inputs[this.currentAppIndex].id != stdout) {
					this.inputs.forEach((input, i) => {
						// Home or registered app
						if(stdout == input.id) {
							this.currentAppIndex = i;
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

						this.currentAppIndex = this.inputs.length - 1;
						if(this.inputs[this.currentAppIndex]) this.inputs[this.currentAppIndex].id = stdout;
						if(this.inputs[this.currentAppIndex].service) this.inputs[this.currentAppIndex].service.setCharacteristic(Characteristic.ConfiguredName, `${this.currentAppIndex + 1}. ${humanName}`);
					}

					this.tvService.setCharacteristic(Characteristic.ActiveIdentifier, this.currentAppIndex);
					this.log.info(this.ip, "- Switched from device -", stdout);
				}

				this.currentAppOnProgress = false;
			});
		}
	}

	connect(callback) {
		var that = this;
		var error = function() {
			that.log.error(`\n\nCan't connect to "${that.name}",\nwith IP address: ${that.ip}.\nPlease check you ADB connection,\nor make sure your device is on\nand connected to the same network.\n`);
		}

		exec(`adb disconnect ${this.ip}`, (err, stdout, stderr) => {
			exec(`adb connect ${this.ip}`, (err, stdout, stderr) => {
				var connected = false;

				if(!err) {
					connected = stdout.trim();
					connected = connected.includes("connected");
					if(connected) callback();
				} else error();
			});
		});
	}

	update() {
		var that = this;

		// Update TV status every second -> or based on configuration
		this.intervalHandler = setInterval(() => {
			that.checkPower(function(result) {
				if(result == 'error') {
					that.connect();
				} else {
					if(that.awake) that.checkInput();
				}
			});
		}, this.interval);
	}

	dumpsys(callback) {
		var adbCommand = `adb -s ${this.ip} shell "dumpsys power | grep mHoldingDisplay"`;
		exec(adbCommand, (err, stdout, stderr) => {
			if(err) {
				this.limit_retry--;
				this.log.info(this.ip, "- Reconnecting");

				if(this.limit_retry <= 0) {
					this.log.error("\n\nProblem when getting device power status.");
					this.log.error("If your network works fine, please report this output.");
					this.log.error("1. When running this command");
					this.log.error(adbCommand);
					this.log.error("2. Output:");
					this.log.error(stdout);
					this.log.error("3. Error output:");
					this.log.error(stderr, "\n\n");
					clearInterval(this.intervalHandler);
				}
			} else {
				this.limit_retry = LIMIT_RETRY;
				stdout = stdout.trim().split('=')[1];
				callback(err, stdout, stderr);
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