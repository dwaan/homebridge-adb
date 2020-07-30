let exec = require('child_process').exec;
let Service, Characteristic, Homebridge, Accessory;

const PLUGIN_NAME = 'homebridge-adb';
const PLATFORM_NAME = 'HomebridgeADB';
const SLEEP_COMMAND = `dumpsys power | grep mHoldingDisplay | cut -d = -f 2`;
const NO_STATUS = "Can't communicate to device, please check your ADB connection manually";
const LIMIT_RETRY = 5;

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
    if (!config) {
      return;
    }

		this.log = log;
		this.config = config;
		this.api = api;

    // Configuration
		// Name
		this.name = this.config.name || 'Android Device';
		// IP
		this.ip = this.config.ip;
		if (!this.ip) {
		    this.log.info(`Please provide IP for this accessory: ${this.name}`);
			return;
		}
		// Interval
		this.interval = this.config.interval || 5000;
		// Can't be lower than 300 miliseconds, it will flood your network
		if (this.interval < 300) this.interval = 300;
		// Inputs
		this.inputs = this.config.inputs;
		if(!this.inputs) this.inputs = [];
		this.inputs.unshift({ "name": "Home", "id": HOME_APP_ID });
		this.inputs.push({ "name": "Other", "id": OTHER_APP_ID });

		// Variable
		this.awake = false;
		this.currentAppIndex = 0;
		this.currentAppOnProgress = false;
		this.connected = false;
		this.limitRetry = LIMIT_RETRY;


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

		this.connect((connected) => {
			this.connected = connected;

			if (this.connected) {
				// get the acceory information and send it to HB
				exec(`adb -s ${this.ip} shell "getprop ro.product.model && getprop ro.product.manufacturer && getprop ro.serialno"`, (err, stdout, stderr) => {
					if (err) {
						this.log.info(this.ip, "- Can't get accessory information");
						this.log.info(this.ip, "- Please check you ADB connection to this accessory, manually");
					} else {
						stdout = stdout.split("\n");

				    this.tvInfo
				    	.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
				    	.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Google")
				    	.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);

						// Publish the accessories
						this.api.publishExternalAccessories(PLUGIN_NAME, [this.tv]);
					}
				});
			} else {
				this.log.info(this.ip, "- Please check you ADB connection to this accessory, manually");
			}
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
				name = "";

			if (i == 0) type = Characteristic.InputSourceType.HOME_SCREEN;
			else if (i == this.inputs.length - 1) type = Characteristic.InputSourceType.OTHER;

			let humanNumber = i + 1;
			if (humanNumber < 10) humanNumber = "0" + (i + 1);

			if (i >= this.inputs.length) {
				// Create hidden input for future modification
				configured = Characteristic.IsConfigured.NOT_CONFIGURED;
				name = `${humanNumber}. Hidden Input`;
			} else {
				name = input.name;
			}

			let service = this.tv.addService(Service.InputSource, `Input ${i} - ${name}`, i);
			service
				.setCharacteristic(Characteristic.Identifier, i)
				.setCharacteristic(Characteristic.ConfiguredName, `${humanNumber}. ${name}`)
				.setCharacteristic(Characteristic.InputSourceType, type)
				.setCharacteristic(Characteristic.IsConfigured, configured);

			if (configured == Characteristic.IsConfigured.CONFIGURED) {
				this.tvService.addLinkedService(service);
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
					if (err) {
						this.log.info(this.ip, '- Can\'t set volume: ' + key);
					} else {
						this.log.info(this.ip, '- Sending: ' + key);
					}
				});

				callback(null);
			});

		// handle [mute control] - not implemented yet
		this.tvSpeakerService.getCharacteristic(Characteristic.Mute)
			.on('get', (callback) => {
				this.log.debug(this.ip, 'Triggered GET Mute');

				callback(null);
			})
			.on('set', (state, callback) => {
				this.log.debug(this.ip, 'Triggered SET Mute:' + state);

				callback(null);
			});

    this.tvService.addLinkedService(this.tvSpeakerService);
	}

	handleOnOff() {
		// handle [on / off]
		this.tvService.getCharacteristic(Characteristic.Active)
			.on('set', (state, callback) => {
				if(state) {
					// When it sleep, wake it up
					exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_WAKEUP"`, (err, stdout, stderr) => {
						if (err) {
							this.log.info(this.ip, "Can't make accessory wakeup");
						} else {
							this.log.info(this.ip, "Awake");
						}

						this.tvService.updateCharacteristic(Characteristic.Active, state);
						this.limitRetry = LIMIT_RETRY;
						callback(null);
					});
				} else {
					exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_SLEEP"`, (err, stdout, stderr) => {
						if (err) {
							this.log.info(this.ip, "Can't make accessory sleep");
						} else {
							this.log.info(this.ip, "Sleeping");
						}

						this.tvService.updateCharacteristic(Characteristic.Active, state);
						this.limitRetry = LIMIT_RETRY;
						callback(null);
					});
				}
			}).on('get', (callback) => {
				exec(`adb -s ${this.ip} shell "${SLEEP_COMMAND}"`, (err, stdout, stderr) => {
					if (err) {
						this.log.info(this.ip, `Can't switch power state of the accessory`, NO_STATUS);
					} else {
						var output = stdout.trim();

						this.awake = false;
						if (output == 'true') this.awake = true;

						this.log.info(this.ip, "Power on: " + this.awake);
				  }

			    callback(null, this.awake);
				});
			});
	}

	handleInput() {
		// handle [input source]
		this.tvService.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('set', (state, callback) => {
				if (!this.currentAppOnProgress) {
					let adb = `adb -s ${this.ip} shell "input keyevent KEYCODE_HOME"`;

					this.currentAppIndex = state;
					this.currentAppOnProgress = true;

					if (this.currentAppIndex != 0 && this.inputs[this.currentAppIndex].id != OTHER_APP_ID) adb = `adb -s ${this.ip} shell "monkey -p ${this.inputs[this.currentAppIndex].id} 1"`;

					exec(adb, (err, stdout, stderr) => {
						this.log.info(this.ip, "Switched from home app -", this.inputs[this.currentAppIndex].id);
						setTimeout(() =>{ this.currentAppOnProgress = false; }, 1000);
					});
				}

				callback(null);
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
				if(state == Characteristic.TargetMediaState.PLAY)
					this.log.info(this.ip, '- Get Media: Accessory is playing');
				else if(state == Characteristic.TargetMediaState.PAUSE)
					this.log.info(this.ip, '- Get Media: Accessory is paused');
				else
					this.log.info(this.ip, '- Get Media: Accessory is stoped');

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
						key = 'KEYCODE_BACK';
						break;
					}
					case Characteristic.RemoteKey.EXIT: {
						key = 'KEYCODE_HOME';
						break;
					}
					case Characteristic.RemoteKey.PLAY_PAUSE: {
						key = 'KEYCODE_MEDIA_PLAY_PAUSE';
						break;
					}
					case Characteristic.RemoteKey.INFORMATION: {
						key = 'KEYCODE_INFO';
						break;
					}
				}

				exec(`adb -s ${this.ip} shell "input keyevent ${key}"`, (err, stdout, stderr) => {
					if (err) {
						this.log.info(this.ip, '- Can\'t send: ' + key);
					} else {
						this.log.info(this.ip, '- Sending: ' + key);
					}

					callback(null);
				});
			});
	}

	checkPower() {
		exec(`adb -s ${this.ip} shell "${SLEEP_COMMAND}"`, (err, stdout, stderr) => {
			if (err) {
				this.log.info(this.ip, `No power state from the accessory`, NO_STATUS);
			} else {
				var output = stdout.trim();

				if ((output == 'true' && !this.awake) || (output == 'false' && this.awake)) {
					this.awake = !this.awake;
					this.tvService.getCharacteristic(Characteristic.Active).updateValue(this.awake);
				}
			}
		});
	}

	checkInput(error, value, appId) {
		if (!this.currentAppOnProgress) {
			this.currentAppOnProgress = true;

			exec(`adb -s ${this.ip} shell "dumpsys window windows | grep -E mFocusedApp"`, (err, stdout, stderr) => {
				let otherApp = true;
				stdout = stdout.trim();

				// Identified current focused app
				if (stdout) {
					stdout = stdout.split("/");
					stdout[0] = stdout[0].split(" ");
					stdout[0] = stdout[0][4];

					if (stdout[1].includes("Launcher") || stdout[1].includes("MainActivity") || stdout[1].includes("RecentsTvActivity")) stdout = this.inputs[0].id;
					else stdout = stdout[0];
				} else {
					stdout = OTHER_APP_ID;
				}

				if (err) {
					this.log.info(this.ip, `No inputs states from the accessory`, NO_STATUS);
				} else if (this.inputs[this.currentAppIndex].id != stdout) {
					this.inputs.forEach((input, i) => {
						// Home or registered app
						if (stdout == input.id) {
							this.currentAppIndex = i;
							otherApp = false;
						}
					});

					// Other app
					if (otherApp) {
						let name = stdout.split("."),
							humanName = "",
							i = 0;

						// Extract human readable name from app package name
						while(name[i]) {
							name[i] = name[i].charAt(0).toUpperCase() + name[i].slice(1);
							if (i > 0)
								if (name[i] != "Com" && name[i] != "Android")
									if (name[i] == "Vending") humanName += "Play Store";
									else if (name[i] == "Gm") humanName += "GMail";
									else humanName += (" " + name[i]);
							i++;
						}
						humanName = humanName.trim();
						if (humanName != "Other") humanName = `Other (${humanName.trim()})`;

						this.currentAppIndex = this.inputs.length - 1;
						if (this.inputs[this.currentAppIndex]) this.inputs[this.currentAppIndex].id = stdout;
						if (this.inputs[this.currentAppIndex].service) this.inputs[this.currentAppIndex].service.setCharacteristic(Characteristic.ConfiguredName, `${this.currentAppIndex + 1}. ${humanName}`);
					}

					this.tvService.setCharacteristic(Characteristic.ActiveIdentifier, this.currentAppIndex);
					this.log.info(this.ip, "Switched from device -", stdout);
				}

				this.currentAppOnProgress = false;
			});
		}
	}

	connect(callback) {
		exec(`adb disconnect ${this.ip} > /dev/null && adb connect ${this.ip}`, (err, stdout, stderr) => {
			var connected = false;

			if (!err) {
				connected = stdout.trim();
				connected = connected.includes("connected");
			}

			if (connected) {
				this.update();
				this.log.info(this.ip, "- Connected");
			} else {
				exec(`adb disconnect ${this.ip}`);
				this.log.info(this.ip, "- Can't connect to this accessory :(");
			}

			this.log.info(this.ip, "- Connection attempt", this.limitRetry);
			this.limitRetry--;

			callback(connected);
		});
	}

	update(interval) {
  	// Update TV status every second -> or based on configuration
    this.intervalHandler = setInterval(() => {
    	this.checkPower();
    	if (this.awake) this.checkInput();

    	if (this.limitRetry <= 0) {
			this.log.info(this.ip, "- We didn't hear any news from this accessory, saying good bye. Disconnected");
    		clearInterval(this.intervalHandler);
    	}
    }, this.interval);
	}
}



class ADBPluginPlatform {
	constructor(log, config, api) {
		if (!config) return;

		this.log = log;
		this.api = api;
		this.config = config;

		if (this.api) this.api.on('didFinishLaunching', this.initAccessory.bind(this));
	}

	initAccessory() {
		// read from config.accessories
		if (this.config.accessories && Array.isArray(this.config.accessories)) {
			for (let accessory of this.config.accessories) {
				if (accessory) new ADBPlugin(this.log, accessory, this.api);
			}
		} else if (this.config.accessories) {
			this.log.info('Cannot initialize. Type: %s', typeof this.config.accessories);
		}

		if (!this.config.accessories) {
			this.log.info('-------------------------------------------------');
			this.log.info('Please add one or more accessories in your config');
			this.log.info('------------------------------------------------');
		}
	}
}