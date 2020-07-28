var exec = require('child_process').exec;
var os = require( 'os' );
var Accessory, Service, Characteristic;

const PLUGIN_NAME = 'homebridge-adb';
const PLATFORM_NAME = 'HomebridgeADB';
const SLEEP_COMMAND = `dumpsys power | grep mHoldingDisplay | cut -d = -f 2`;

module.exports = (homebridge) => {
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
		this.ip = this.config.ip;
		this.name = this.config.name || 'Android Device';
		if (!this.ip) {
		    this.log.info(`Please provide IP for this accessory: ${this.name}`);
			return;
		}
		this.interval = this.config.interval || 5000;

		// Variable
		this.awake = false;
		this.currentAppIndex = 0;
		this.currentAppOnProgress = false;
		this.connected = false;
		this.LIMITCONNECT = 5;
		this.limitConnect = this.LIMITCONNECT;

		this.Service = this.api.hap.Service;
		this.Characteristic = this.api.hap.Characteristic;


		/**
		 * Create the accessory
		 */

		// generate a UUID
		const networkInterfaces = os.networkInterfaces();
		const uuid = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name);
		// this.log.info(uuid, 'homebridge:adb-plugin' + networkInterfaces.en0[0].address + this.ip + this.name);

		// create the accessory
		this.tvAccessory = new api.platformAccessory(this.name, uuid);

		// set the accessory category
		this.tvAccessory.category = this.api.hap.Categories.TELEVISION;

		// add the tv service
		this.tvService = this.tvAccessory.addService(this.Service.Television);

		// set sleep discovery characteristic
		this.tvService
			.setCharacteristic(this.Characteristic.ConfiguredName, this.name)
			.setCharacteristic(this.Characteristic.SleepDiscoveryMode, this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		// handle [on / off]
		this.tvService.getCharacteristic(this.Characteristic.Active)
			.on('set', (state, callback) => {
				if(state) {
					// When it sleep, wake it up
					exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_WAKEUP"`, (err, stdout, stderr) => {
						if (err) {
							this.log.info(this.ip, "Can't make accessory wakeup");
						} else {
							this.log.info(this.ip, "Awake");
						}

						this.tvService.updateCharacteristic(this.Characteristic.Active, state);
						this.limitConnect = this.LIMITCONNECT;
						callback(null);
					});
				} else {
					exec(`adb -s ${this.ip} shell "input keyevent KEYCODE_SLEEP"`, (err, stdout, stderr) => {
						if (err) {
							this.log.info(this.ip, "Can't make accessory sleep");
						} else {
							this.log.info(this.ip, "Sleeping");
						}

						this.tvService.updateCharacteristic(this.Characteristic.Active, state);
						this.limitConnect = this.LIMITCONNECT;
						callback(null);
					});
				}
			}).on('get', (callback) => {
				exec(`adb -s ${this.ip} shell "${SLEEP_COMMAND}"`, (err, stdout, stderr) => {
					if (err) {
						this.log.info(this.ip, "Can't get accessory status");
					} else {
						var output = stdout.trim();

						this.awake = false;
						if (output == 'true') this.awake = true;

						this.log.info(this.ip, "Power on: " + this.awake);
				  }

			    callback(null, this.awake);
				});
			});

		// handle [input source]
		this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
			.on('set', (state, callback) => {
				if (!this.currentAppOnProgress) {
					let adb = `adb -s ${this.ip} shell "input keyevent KEYCODE_HOME"`;

					this.currentAppIndex = state;
					this.currentAppOnProgress = true;

					if (this.currentAppIndex != 0) adb = `adb -s ${this.ip} shell "monkey -p ${this.inputs[this.currentAppIndex].id} 1"`;

					exec(adb, (err, stdout, stderr) => {
						this.log.info(this.ip, "Switched from home app -", this.inputs[this.currentAppIndex].id);
						setTimeout(() =>{ this.currentAppOnProgress = false; }, this.interval);
					});
				}

				callback(null);
			});

		// handle [media status] - not implemented yet
		this.tvService.getCharacteristic(this.Characteristic.CurrentMediaState)
			.on('set', (state, callback) => {
				if(state == this.Characteristic.CurrentMediaState.PLAY)
					this.log.info(this.ip, '- Accessory is playing');
				else if(state == this.Characteristic.CurrentMediaState.PAUSE)
					this.log.info(this.ip, '- Accessory is paused');
				else if(state == this.Characteristic.CurrentMediaState.STOP)
					this.log.info(this.ip, '- Accessory is stoped');
				else if(state == this.Characteristic.CurrentMediaState.LOADING)
					this.log.info(this.ip, '- Accessory is loading');
				else
					this.log.info(this.ip, '- Accessory is interupted');

				callback(null);
			});

		// handle [media state] - not implemented yet
		this.tvService.getCharacteristic(this.Characteristic.TargetMediaState)
			.on('get', (callback) => {
				if(state == this.Characteristic.TargetMediaState.PLAY)
					this.log.info(this.ip, '- Get Media: Accessory is playing');
				else if(state == this.Characteristic.TargetMediaState.PAUSE)
					this.log.info(this.ip, '- Get Media: Accessory is paused');
				else
					this.log.info(this.ip, '- Get Media: Accessory is stoped');

				callback(null);
			})
			.on('set', (state, callback) => {
				if(state == this.Characteristic.TargetMediaState.PLAY)
					this.log.info(this.ip, '- Set Media: Accessory is playing');
				else if(state == this.Characteristic.TargetMediaState.PAUSE)
					this.log.info(this.ip, '- Set Media: Accessory is paused');
				else
					this.log.info(this.ip, '- Set Media: Accessory is stoped');

				callback(null);
			});

		// handle [remote control]
		this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
			.on('set', (state, callback) => {
				var key = "";

				switch(state) {
					case this.Characteristic.RemoteKey.REWIND: {
						key = 'KEYCODE_MEDIA_REWIND';
						break;
					}
					case this.Characteristic.RemoteKey.FAST_FORWARD: {
						key = 'KEYCODE_MEDIA_FAST_FORWARD';
						break;
					}
					case this.Characteristic.RemoteKey.NEXT_TRACK: {
						key = 'KEYCODE_MEDIA_NEXT';
						break;
					}
					case this.Characteristic.RemoteKey.PREVIOUS_TRACK: {
						key = 'KEYCODE_MEDIA_PREVIOUS';
						break;
					}
					case this.Characteristic.RemoteKey.ARROW_UP: {
						key = 'KEYCODE_DPAD_UP';
						break;
					}
					case this.Characteristic.RemoteKey.ARROW_DOWN: {
						key = 'KEYCODE_DPAD_DOWN';
						break;
					}
					case this.Characteristic.RemoteKey.ARROW_LEFT: {
						key = 'KEYCODE_DPAD_LEFT';
						break;
					}
					case this.Characteristic.RemoteKey.ARROW_RIGHT: {
						key = 'KEYCODE_DPAD_RIGHT';
						break;
					}
					case this.Characteristic.RemoteKey.SELECT: {
						key = 'KEYCODE_ENTER';
						break;
					}
					case this.Characteristic.RemoteKey.BACK: {
						key = 'KEYCODE_BACK';
						break;
					}
					case this.Characteristic.RemoteKey.EXIT: {
						key = 'KEYCODE_HOME';
						break;
					}
					case this.Characteristic.RemoteKey.PLAY_PAUSE: {
						key = 'KEYCODE_MEDIA_PLAY_PAUSE';
						break;
					}
					case this.Characteristic.RemoteKey.INFORMATION: {
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



		/**
		 * Create a speaker service to allow volume control
		 */

		this.speakerService = this.tvAccessory.addService(this.Service.TelevisionSpeaker);

		this.speakerService
			.setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
			.setCharacteristic(this.Characteristic.VolumeControlType, this.Characteristic.VolumeControlType.ABSOLUTE);

		// handle [volume control]
		this.speakerService.getCharacteristic(this.Characteristic.VolumeSelector)
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
		this.speakerService.getCharacteristic(this.Characteristic.Mute)
			.on('get', (callback) => {
				this.log.debug(this.ip, 'Triggered GET Mute');

				callback(null);
			})
			.on('set', (state, callback) => {
				this.log.debug(this.ip, 'Triggered SET Mute:' + state);

				callback(null);
			});



		/**
		 * Create TV Input Source Services
		 * These are the inputs the user can select from.
		 * When a user selected an input the corresponding Identifier Characteristic
		 * is sent to the TV Service ActiveIdentifier Characteristic handler.
		 */

		this.inputs = this.config.inputs;
		if(!this.inputs) this.inputs = [];
		this.inputs.unshift({ "name": "Home", "id": "home" });
		this.inputs.push({ "name": "Other", "id": "other" });

		this.inputsAccessory = [];
		this.inputs.forEach((input, i) => {
			let type = this.Characteristic.InputSourceType.APPLICATION;
			if (i == 0) type = this.Characteristic.InputSourceType.HOME_SCREEN;
			else if (i == this.inputs.length - 1) type = this.Characteristic.InputSourceType.OTHER;

			this.inputsAccessory[i] = this.tvAccessory.addService(this.Service.InputSource, 'input' + i, 'Input ' + i + " - " + input.name);
			this.inputsAccessory[i]
				.setCharacteristic(this.Characteristic.Identifier, i)
				.setCharacteristic(this.Characteristic.ConfiguredName, `${i + 1}. ${input.name}`)
				.setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
				.setCharacteristic(this.Characteristic.InputSourceType, type);
			this.tvService.addLinkedService(this.inputsAccessory[i]);
		});


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
						this.log.info(this.ip, "- Please check you ADB connection to this accessory manually");
					} else {
						stdout = stdout.split("\n");
						// set the tv information
						this.info = this.tvAccessory.getService(this.Service.AccessoryInformation);

					    this.info
					    	.setCharacteristic(this.Characteristic.Model, stdout[0] || "Android")
					    	.setCharacteristic(this.Characteristic.Manufacturer, stdout[1] || "Google")
					    	.setCharacteristic(this.Characteristic.SerialNumber, stdout[2] || this.ip);

						// Publish the acceory
						this.api.publishExternalAccessories(PLUGIN_NAME, [this.tvAccessory]);
					}
				});
			} else {
				this.log.info(this.ip, "- Please check you ADB connection to this accessory manually");
			}
		});
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

			this.log.info(this.ip, "- Connection attempt", this.limitConnect);
			this.limitConnect--;

			callback(connected);
		});
	}

	update(interval) {
	  	// Update TV status every second -> or based on configuration
	    this.intervalHandler = setInterval(() => {
	    	this.checkPower();
	    	if (this.awake) this.checkInput();

	    	if (this.limitConnect <= 0) {
				this.log.info(this.ip, "- We didn't hear any news from this accessory, saying good bye. Disconnected");
	    		clearInterval(this.intervalHandler);
	    	}
	    }, this.interval);
	}

	checkPower() {
		exec(`adb -s ${this.ip} shell "${SLEEP_COMMAND}"`, (err, stdout, stderr) => {
			if (err) {
				this.log.info(this.ip, "Can't get accessory status");
			} else {
				var output = stdout.trim();

				if ((output == 'true' && !this.awake) || (output == 'false' && this.awake)) {
					this.awake = !this.awake;
					this.tvService.getCharacteristic(this.Characteristic.Active).updateValue(this.awake);
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
					stdout = "other";
				}

				if (err) {
					this.log.info(this.ip, "Can't get accessory status");
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
						this.inputs[this.currentAppIndex].id = stdout;
						this.inputsAccessory[this.currentAppIndex].setCharacteristic(this.Characteristic.ConfiguredName, `${this.currentAppIndex + 1}. ${humanName}`);
					}

					this.tvService.setCharacteristic(this.Characteristic.ActiveIdentifier, this.currentAppIndex);
					this.log.info(this.ip, "Switched from device -", stdout);
				}

				this.currentAppOnProgress = false;
			});
		}
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

	configureAccessory(platformAccessory) {
	}

	removeAccessory(platformAccessory) {
		this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
	}
}