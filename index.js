let wol = require('wake_on_lan');
let exec = require('child_process').exec;
let Service, Characteristic, Homebridge, Accessory;

const PLUGIN_NAME 	= 'homebridge-adb';
const PLATFORM_NAME = 'HomebridgeADB';

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
		// Path
		this.path = this.config.path || "";
		// IP
		this.ip = this.config.ip;
		if(!this.ip) {
			this.log.error(`\n\nPlease provide IP for this accessory: ${this.name}\n`);
			return;
		}
		// Mac
		this.mac = this.config.mac || "";
		// Interval
		this.interval = this.config.interval || 5000;
		// Can't be lower than 300 miliseconds, it will flood your network
		if(this.interval < 300) this.interval = 300;
		// Show more debug
		this.debug = this.config.debug || false;
		// Skip speaker creation
		this.skipSpeaker = this.config.skipSpeaker || false;
		// Exec timeout
		this.timeout = this.config.timeout || 3000;
		if(this.timeout < 1000) this.interval = 1000;
		// Inputs
		this.inputs = this.config.inputs || [];
		this.hidenumber = this.config.hidenumber || false;
		this.hidehome = this.config.hidehome || false;
		this.hideother = this.config.hideother || false;
		if(!this.hidehome) this.inputs.unshift({ "name": "Home", "id": HOME_APP_ID });
		if(!this.hideother) this.inputs.push({ "name": "Other", "id": OTHER_APP_ID });
		// Sensor
		this.playbacksensor = this.config.playbacksensor || false;
		this.playbacksensorexclude =  this.config.playbacksensorexclude || "";
		this.playbacksensordelay = this.config.playbacksensordelay || 0;
		this.playbacksensortimeout = false;
		// Power ON/OFF
		this.poweron = this.config.poweron || "KEYCODE_POWER";
		this.poweroff = this.config.poweroff || this.poweron;
		// Power ON/OFF Executable
		this.poweronexec = this.config.poweronexec;
		this.poweroffexec = this.config.poweroffexec;
		// Category
		this.category = this.config.category || "TELEVISION";
		this.category = this.category.toUpperCase();

		// Variable
		this.wol = false;
		this.woltimeout = false;
		this.awake = false;
		this.playing = false;
		this.currentInputIndex = 0;
		this.currentApp = false;
		this.currentAppOnProgress = false;
		this.checkPowerOnProgress = false;
		this.checkPlaybackProgress = false;
		this.prevStdout = "";

		// Playback
		this.noPlaybackSensor = false;
		this.useTail = undefined;
		this.useHead = undefined;

		// Check Input
		this.checkInputDisplayError = true;
		this.checkInputUseActivities = 0;
		this.checkInputUseWindows = 0; 

		// Debug and Info
		this.prevDebugMessage = ["", ""];
		this.prevInfoMessage = "";

		// Extra
		this.unrecognized = false;
		this.handleOnOffOnProgress = false;


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
		this.deviceService = this.device.addService(Service.Television);

		// get device information
		this.deviceInfo = this.device.getService(Service.AccessoryInformation);

		// set device service name
		this.deviceService.setCharacteristic(Characteristic.ConfiguredName, this.name);
		this.deviceService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		/**
		 * Publish as external accessory
		 * Check ADB connection before publishing the accesory
		 */

		this.displayInfo(`Initializing`);

		// Get the accesory information and send it to HomeBridge
		this.exec(`${this.path}adb -s ${this.ip} shell "getprop ro.product.model && getprop ro.product.manufacturer && getprop ro.serialno"`, (err, stdout) => {
			if(err) {
				this.log.error(`\n\nWARNING:\nUnrecognized device - "${this.name}".\nPlease check if the device IP address is correct.\nIf your device is turned off, please turn it on\nand restart this plugin.\n`);
			} else {
				// Get device information
				stdout = stdout.split("\n");

				// Check if device have tail and head command
				this.checkTailHead();

				// Handle On Off
				this.handleOnOff();

				if(this.inputs.length > 0) {
					// Create inputs
					this.createInputs();

					// Handle inputs
					this.handleInputs();
				}

				// Show Control Center Remote if needed
				this.handleRemoteControl();

				// Create speaker services
				this.createTelevisionSpeakers();

				// Publish tv accessories
				this.createTelevision(stdout);

				// Playback sensor
				this.createPlaybackSensor(uuidos, stdout);

				// Device finish initialzing
				this.displayInfo(`Device initialized.`);

				// Loop the power status
				this.update();
			}
		});
	}

	/**
	 * Create television accesory based on ADB information
	 * @param {string} stdout ADB output
	 */
	createTelevision(stdout) {
		this.deviceInfo
			.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
			.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Google")
			.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);
		this.api.publishExternalAccessories(PLUGIN_NAME, [this.device]);
		this.displayDebug(`Device created`);
	}

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
	 */
	createInputs() {
		for (let i = 0; i < 50; i++) {
			let
				input = this.inputs[i],
				type = Characteristic.InputSourceType.APPLICATION,
				configured = Characteristic.IsConfigured.CONFIGURED,
				targetVisibility = Characteristic.TargetVisibilityState.SHOWN,
				currentVisibility = Characteristic.CurrentVisibilityState.SHOWN,
				name = "";

			if(i == 0 && !this.hidehome) type = Characteristic.InputSourceType.HOME_SCREEN;
			else if(i == this.inputs.length - 1 && !this.hideother) type = Characteristic.InputSourceType.OTHER;

			let humanNumber = i + 1;
			if(humanNumber < 10) humanNumber = "0" + (i + 1);

			if(i >= this.inputs.length || !input.name || !input.id) {
				// Create hidden input when name and id is empty and for future modification
				configured = Characteristic.IsConfigured.NOT_CONFIGURED;
				targetVisibility = Characteristic.TargetVisibilityState.HIDDEN;
				currentVisibility = Characteristic.CurrentVisibilityState.HIDDEN;
				name = `${humanNumber}. Hidden Input`;
			} else {
				name = `${input.name}`;
				if(!this.hidenumber) name = `${humanNumber}. ${name}`;
			}

			this.displayDebug(this.name, name, targetVisibility, currentVisibility);
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

	/**
	 * Create a speaker service to allow volume control
	 */
	createTelevisionSpeakers() {
		 if(!this.skipSpeaker) {
			this.deviceTelevisionSpeakerService = this.device.addService(Service.TelevisionSpeaker);

			this.deviceTelevisionSpeakerService
				.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
				.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE); // RELATIVE or ABSOLUTE

			// Volume control
			this.deviceTelevisionSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
				.on('set', (state, callback) => {
					let key = state ? "KEYCODE_VOLUME_DOWN" : "KEYCODE_VOLUME_UP";

					this.exec(`${this.path}adb -s ${this.ip} shell "input keyevent ${key}"`, (err) => {
						if(err) this.displayDebug(`Can't set volume`);
						else this.displayDebug(`Sending volume key`);
					});

					callback(null);
				});

			// Mute control - not implemented yet
			this.deviceTelevisionSpeakerService.getCharacteristic(Characteristic.Mute)
				.on('get', (callback) => {
					callback(null, 0);
				})
				.on('set', (state, callback) => {
					callback(null);
				});

			this.deviceService.addLinkedService(this.deviceTelevisionSpeakerService);

			this.displayDebug(`Speaker created`);
		}
	}

	/**
	 * Create a playback sensor based on video playback
	 * Due to limitation of ADB, support for playback will be limited
	 */
	createPlaybackSensor(uuidos, stdout) {
		if(this.playbacksensor) {
			// Add playback sensor
			this.devicePlaybackSensor = new this.api.platformAccessory(this.name + " Playback Sensor", uuidos);
			this.devicePlaybackSensor.category = this.api.hap.Categories.SENSOR;
			this.devicePlaybackSensorInfo = this.devicePlaybackSensor.getService(Service.AccessoryInformation);
			this.devicePlaybackSensorService = this.devicePlaybackSensor.addService(Service.MotionSensor);
			this.handleMediaAsSensor();

			// Publish playback sensor
			this.devicePlaybackSensorInfo
				.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
				.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Google")
				.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);
			this.api.publishExternalAccessories(PLUGIN_NAME, [this.devicePlaybackSensor]);
			this.displayDebug(`Sensor created`);
		}
	}

	/**
	 * Handle On/Off
	 */
	handleOnOff() {
		this.deviceService.getCharacteristic(Characteristic.Active)
			.on('set', (state, callback) => {
				if(state != this.awake && !this.handleOnOffOnProgress) {
					// Prevent double run
					this.handleOnOffOnProgress = true;

					if(state) {
						// Power On
						this.deviceService.updateCharacteristic(Characteristic.Active, state);
						this.checkInputDisplayError = false;
						this.displayDebug("Trying to Turn On device");
									
						if(this.mac) {
							wol.wake(`${this.mac}`, { address: `${this.ip}` }, (error) => {
								if(error) {
									this.displayInfo("Wake On LAN - Power On - Failed");
									state = !state;
								} else {
									// Forcing device status on
									this.wol = true;
									this.awake = true;
									this.displayDebug("Wake On LAN - Power On");
									// After 3 seconds,  WOL status will be reset, 
									// and let ADB get the power status from device
									this.woltimeout = setTimeout(() => {
										this.displayDebug("Wake On LAN - Reset");
										this.wol = false;
										this.woltimeout = false;
									}, 3000);
								}

								this.handleOnOffOnProgress = false;
								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							});
						} else if(this.poweronexec) {
							this.exec(`${this.poweronexec}`, (err, stdout) => {
								this.displayDebug("Executing Power On");
								if(err) {
									this.displayInfo("Executable - Power Off - Failed");
									this.displayDebug("Error: " + stdout);
									state = !state;
								} else {
									this.displayDebug("Executable - Power On");
								}

								this.handleOnOffOnProgress = false;
								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							});
						} else {
							this.execWithTimeout(`${this.path}adb -s ${this.ip} shell "input keyevent ${this.poweron}"`, 15000, (err, stdout) => {
								if(err) {
									this.displayInfo("ADB - Power On - Failed");
									this.displayDebug("Error: " + stdout);
									state = !state;
								} else {
									this.displayDebug("ADB - Power On");
								}

								this.handleOnOffOnProgress = false;
								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							}, true);
						}
					} else {
						// Power Off
						this.deviceService.updateCharacteristic(Characteristic.Active, state);
						this.displayDebug("Trying to Turn Off device");

						if(this.poweroffexec) {
							this.exec(`${this.poweroffexec}`, (err, stdout) => {
								this.displayDebug("Executing Power Off");
								if(err) {
									this.displayInfo("Executable - Power Off - Failed");
									this.displayDebug("Error: " + stdout);
									state = !state;									
								} else {
									this.displayDebug("Executable - Power Off");
								}

								this.handleOnOffOnProgress = false;
								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							});
						} else {
							this.exec(`${this.path}adb -s ${this.ip} shell "input keyevent ${this.poweroff}"`,(err, stdout) => {
								if(err) {
									this.displayInfo("ADB - Power Off - Failed");
									this.displayDebug("Error: " + stdout);
									state = !state;
								} else {
									this.displayDebug("ADB - Power Off");
								}

								this.handleOnOffOnProgress = false;
								this.deviceService.updateCharacteristic(Characteristic.Active, state);
							});
						}
					}
				} 

				callback(null);
			}).on('get', (callback) => {
				this.checkPowerOnProgress = false;
				this.checkPower(() => {
					this.deviceService.setCharacteristic(Characteristic.Active, this.awake);
				});

				callback(null, this.awake);
			});
	}

	/**
	 * Handle input change
	 */
	handleInputs() {
		this.deviceService.getCharacteristic(Characteristic.ActiveIdentifier)
			.on('set', (state, callback) => {
				if(!this.currentAppOnProgress) {
					let adb = `${this.path}adb -s ${this.ip} shell "input keyevent KEYCODE_HOME"`;

					this.currentAppOnProgress = true;
					this.currentInputIndex = state;

					if(this.currentInputIndex != 0 && this.inputs[this.currentInputIndex].id != OTHER_APP_ID) {
						let type = this.inputs[this.currentInputIndex].id.trim();

						if(this.inputs[this.currentInputIndex].adb) {
							// Run specific custom ADB command
							adb = `${this.path}adb -s ${this.ip} shell "${this.inputs[this.currentInputIndex].adb}"`;
							this.displayDebug(`Running - ADB command - ${this.inputs[this.currentInputIndex].adb}`);
						} else if(!type.includes(" ") && type.includes(".")) {
							// Run app based on given valid id
							adb = `${this.path}adb -s ${this.ip} shell "monkey -p ${this.inputs[this.currentInputIndex].id} 1"`;
							this.displayDebug(`Running - App - ${this.inputs[this.currentInputIndex].id}`);
						} else {
							// Run ID as it's an ADB command
							adb = `${this.path}adb -s ${this.ip} shell "${this.inputs[this.currentInputIndex].id}"`;
							this.displayDebug(`Running - ${this.inputs[this.currentInputIndex].id}`);
						}
					}

					this.exec(adb, (err) => {
						if(err) this.displayInfo(`handleInputs - Can't open ${this.inputs[this.currentInputIndex].name}`);
						else {
							this.currentApp = this.inputs[this.currentInputIndex].id;
							this.displayInfo(`handleInputs - ${this.inputs[this.currentInputIndex].name}`);
						}

						this.currentAppOnProgress = false;
					});
				}

				callback(null);
			});
	}

	/**
	 * Handle playback sensor
	 */
	handleMediaAsSensor() {
		// handle [media state]
		this.devicePlaybackSensorService.getCharacteristic(Characteristic.MotionDetected)
			.on('get', (callback) => {
				var state = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
				if(this.playing) state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;

				this.checkPlayback();
				callback(null, state);
			});
	}

	/**
	 * Handle control center remote controll
	 */
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

				this.exec(`${this.path}adb -s ${this.ip} shell "input keyevent ${key}"`, (err) => {
					if(err) this.displayDebug(`handleRemoteControl - Can't send: ${key}`);
					else this.displayDebug(`handleRemoteControl - Sending: ${key}`);
				});
				callback(null);
			});
	}

	/**
	 * Check whether to use tail or head for more optimized output
	 */
	checkTailHead() {
		if(this.useTail === undefined) this.exec(`${this.path}adb -s ${this.ip} shell "tail --help"`, (err) => {
			if(err) {
				this.displayDebug(`Can't use tail command.`);
				this.useTail = false;
			} else this.useTail = true;
		});
		if(this.useHead === undefined) this.exec(`${this.path}adb -s ${this.ip} shell "head --help"`, (err) => {
			if(err) {
				this.displayDebug(`Can't use head command`);
				this.useHead = false;
			} else this.useHead = true;
		});
	}

	/**
	 * Check if a video is playing
	 */
	checkPlayback() {
		var that = this;
		var changed = false;
		var state = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
		var tail = "";
		var head = ""

		if(this.useHead === true) head = " | head -1";
		if(this.useTail === true) tail = " | tail -1";

		if(!this.awake) {
			// When device is asleep, set the sensor off
			if(this.playing) {
				this.displayDebug(`checkPlayback - device is asleep`);
				this.playing = false;
				this.devicePlaybackSensorService.setCharacteristic(Characteristic.MotionDetected, state);
			}
		} else if(!this.checkPlaybackProgress && this.currentApp && !this.playbacksensorexclude.includes(this.currentApp)) {
			if(!this.noPlaybackSensor) {
				var changeState = function(state, stdout) {
					if(changed) {
						that.playbacksrsensortimeout = setTimeout(function() {
							if(stdout) that.displayDebug(`checkPlayback - ${stdout}`);
							that.displayDebug(`checkPlayback - Current app - ${that.currentApp}`);
							that.displayDebug(`checkPlayback - ${that.playing}`);
							that.displayInfo(`Media playing - ${that.playing}`);
							that.devicePlaybackSensorService.setCharacteristic(Characteristic.MotionDetected, state);
						}, that.playbacksensordelay);
					}

					that.checkPlaybackProgress = false;	
				}
				var errorState = function(using) {
					if(that.playing) {
						that.displayDebug(`checkPlayback - error - using ${using}`);

						that.playing = false;
						changed = true;
					}
				}

				this.checkPlaybackProgress = true;

				this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys media_session | grep -e 'Media button session is' -e 'AlexaMediaPlayerRuntime'"`, (err, stdout) => {
					if(err) {
						this.displayDebug(`checkPlayback - error - checking current media app`);
					} else if(this.currentApp == HOME_APP_ID || this.currentApp != OTHER_APP_ID || stdout.includes(this.currentApp) || stdout.includes('AlexaMediaPlayerRuntime')) {
						this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys media_session | grep 'state=PlaybackState'"`, (err, stdout) => {
							if(err) errorState('media_session');
							else {
								if(stdout != "") {
									if(stdout.includes("state=3")) {
										if(!this.playing) {
											state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
											this.playing = true;
											changed = true;
										}
									} else if(this.playing) {
										this.playing = false;
										changed = true;
									}
								} else {
									this.displayDebug(`checkPlayback - media_session - no audio playing?`);
								}
							}

							changeState(state, 'media_session - ' + stdout);
						});
					} else {
						this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys audio | grep 'player piid:' | grep ' state:' ${tail}"`, (err, stdout) => {
							// After restart, android device will display error when running this command
							if(err) errorState('audio');
							else {
								if(stdout != "") {
									stdout = stdout.trim().split("\n");
									stdout = stdout[stdout.length - 1].trim();

									if(stdout.includes("state:started")) {
										if(!this.playing) {
											state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
											this.playing = true;
											changed = true;
										}
									} else if(this.playing) {
										this.playing = false;
										changed = true;
									}
								} else {
									this.displayDebug(`checkPlayback - audio - no audio playing?`);
								}
							}

							changeState(state, 'audio - ' + stdout);
						});
					}
				});
			}
		}
	}

	/**
	 * Check current running app and apply it to the input
	 */
	checkInput() {
		var parseInput = (stdout) => {
			if(!stdout || stdout == "") return false;
			stdout = stdout.trim();

			if(stdout != this.prevStdout) {
				let otherApp = true;

				// Identified current focused app
				this.prevStdout = stdout.trim();
				if(stdout) {
					stdout = stdout.trim().split("/");
					stdout[0] = stdout[0].split(" ");
					stdout[0] = stdout[0][stdout[0].length - 1];

					if(stdout[0] == undefined) stdout[0] = HOME_APP_ID;
					if(stdout[1] == undefined) stdout[1] = "";

					if(!this.hidehome && (stdout[1].includes("Launcher") || stdout[1].substr(0, 13) == ".MainActivity" || stdout[1].includes("RecentsTvActivity"))) stdout = this.inputs[0].id;
					else stdout = stdout[0];
				} else stdout = OTHER_APP_ID;

				if(this.inputs.length > 0) {
					if(this.inputs[this.currentInputIndex].id != stdout && (stdout === HOME_APP_ID || this.inputs[this.currentInputIndex].type !== 'command')) {
						this.inputs.forEach((input, i) => {
							// Home or registered app
							if(stdout == input.id) {
								this.currentInputIndex = i;
								otherApp = false;
							}
						});

						// Other app
						if(otherApp && !this.hideother) {
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
							if(this.inputs[this.currentInputIndex].service) {
								if(!this.hidenumber) humanName = `${this.currentInputIndex + 1}. ${humanName}`;
								this.inputs[this.currentInputIndex].service.setCharacteristic(Characteristic.ConfiguredName, `${humanName}`);
							}
						}

						this.deviceService.updateCharacteristic(Characteristic.ActiveIdentifier, this.currentInputIndex);
					}
				}

				if(this.currentApp != stdout) {
					this.displayInfo(`Current app - \x1b[4m${stdout}\x1b[0m`);
					this.currentApp = stdout;
				}

			}

			return true;
		}

		if(this.awake && !this.currentAppOnProgress) {
			this.currentAppOnProgress = true;

			if(this.checkInputUseWindows >= 0) {
				this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys window windows | grep -E mFocusedApp"`, (err, stdout) => {
					if(err) {
						this.displayDebug(`checkInput - error while using dumpsys window`);
						this.checkInputUseWindows = -1;
					} else {
						this.displayDebug(`checkInput - using dumpsys window`);
						this.checkInputUseWindows = parseInput(stdout) ? 1 : -1;
					}

					this.currentAppOnProgress = false;
				});
			} 

			if(this.checkInputUseWindows < 0 && this.checkInputUseActivities >= 0) {
				this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys activity activities | grep ' ResumedActivity'"`, (err, stdout) => {
					if(err) {
						this.displayDebug(`checkInput - error while using dumpsys activity`);
						this.checkInputUseActivities = -1;
					} else {
						this.displayDebug(`checkInput - using dumpsys activity`);
						this.checkInputUseActivities = parseInput(stdout) ? 1 : -1;
					}

					this.currentAppOnProgress = false;
				});
			}
			
			if(this.checkInputUseActivities < 0 && this.checkInputUseWindows < 0 && this.checkInputDisplayError) {
				this.checkInputDisplayError = false;
				that.displayInfo(`Can't read current app from device.`);
			}
		}
	}

	/**
	 * Check if device is on based on screen status
	 * @param {function} callback a function to run after finish executing ADB
	 */
	checkPower(callback) {
		if(!this.unrecognized && !this.wol && !this.checkPowerOnProgress && !this.handleOnOffOnProgress) {
			this.checkPowerOnProgress = true;

			exec(`${this.path}adb -s ${this.ip} shell "dumpsys power | grep mHoldingDisplay"`, { timeout: this.timeout }, (err, stdout, stderr) => {
				stdout = stdout.trim();
				stderr = stderr.trim();

				if(stdout == "") stdout = stderr;
				if(stderr == "") stderr = stdout;

				if(err) {
					// When device can't be found, set it sleep
					if(this.awake) {
						this.awake = !this.awake;
						this.deviceService.getCharacteristic(Characteristic.Active).updateValue(this.awake);
					}

					if(callback) callback('error');
				} else {
					let output = stdout.split('=')[1];

					if((output == 'true' && !this.awake) || (output == 'false' && this.awake)) {
						this.awake = !this.awake;
						this.deviceService.getCharacteristic(Characteristic.Active).updateValue(this.awake);

						this.displayDebug(`checkPower - ${this.awake}`);
					}

					if(callback) callback(this.awake);
				}

				this.checkPowerOnProgress = false;
			});
		}
	}

	/**
	 * Connect to the device
	 * @param {function} callback callback when connection is success
	 * @param {function} callbackerror callback when there is error when executing ADB
	 */
	connect(callback, callbackerror) {
		this.displayDebug(`Reconnecting...`);

		exec(`${this.path}adb connect ${this.ip}`, { timeout: this.timeout }, (err, stdout, stderr) => {
			var message = "";

			stdout = stdout.trim() || stderr.trim();
			stderr = stderr.trim() || stdout;

			this.unrecognized = false;
			if(stdout.includes(`device still authorizing`)) {
				err = false;
				message = `Device still authorizing. Please wait.`;
			} else if(stdout.includes(`device unauthorized.`)) {
				err = false;
				message = `Unauthorized device. Please check your device screen for authorization popup.`;
			} else if(stdout.includes(`Connection refused`)) {
				err = true;
				message = `Connection refused. Please check your configuration and restart this plugin.`;
				this.unrecognized = true;
			} else if(stdout.includes(`Operation timed out. Reconnecting...`)) {
				err = false;
				message= `Connection timeout. Reconnecting...`
			} else if(err || stdout.includes(`failed to connect`)) {
				message = `Device disconnected or turned off. Reconnecting...`;
			} else if(!stdout.includes(`already connected`)){
				this.displayDebug(stdout);
			}
			
			if(message) {
				this.displayInfo(`${message}`);

				if(!this.unrecognized) {
					// When ADB server get killed, "adb connect" will return the connection in approx 7 seconds
					exec(`${this.path}adb connect ${this.ip}`, { timeout: 10000 }, (err) => {
						if(!err) {
							this.displayInfo(`Reconnected`);
							if(callback) callback();
						}
					});
				}

				if(callbackerror) callbackerror(err, message);
			} else {
				this.displayDebug(`Reconnected`);
				if(callback) callback();
			}
		});
	}

	/**
	 * The main loop to check device power, input, and playback status.
	 */
	update() {
		// Update device status every second -> or based on configuration
		this.intervalHandler = setInterval(() => {
			this.checkPower((awake) => {
				if(awake == 'error') {
					// Can't check the device power status, try reconnect
					this.connect();
				} else if(awake) {
					// Check for current input when device is on
					this.checkInput();
					// Check playback status when device is on
					if(this.playbacksensor) this.checkPlayback();
				}
			});
		}, this.interval);
	}

	/**
	 * A helper for executing ADB command
	 * @param {string} cmd the shell command
	 * @param {function} callback callback when command succesully executed
	 * @param {boolean} chatty output more debug
	 */
	exec(cmd, callback, chatty) {
		this.execWithTimeout(cmd, this.timeout, callback, chatty);
	}

	/**
	 * A helper for executing ADB command
	 * @param {string} cmd the shell command
	 * @param {int} timeout timeout in miliseconds
	 * @param {function} callback callback when command succesully executed
	 * @param {boolean} chatty output more debug
	 */
	execWithTimeout(cmd, timeout, callback, chatty) {
		if(chatty) this.displayDebug(`Running - ${cmd}`);
		if(!this.unrecognized) {
			exec(cmd, { timeout: timeout }, (err, stdout, stderr) => {
				stdout = stdout.trim() || stderr.trim();
				stderr = stderr.trim() || stdout;

				if(err && (
					stdout.includes(`error: device '${this.ip}' not found`) || 
					stdout.includes(`error: closed`) || 
					stdout.includes(`error: device offline`)
				)) {
					this.connect(() => {
						this.exec(cmd, callback, chatty);
					}, (err, message) => {
						callback(err, message);
					});
				} else {
					callback(stdout.includes(`Operation timed out`), stdout);
				}
			});
		}
	}

	/**
	 * A helper to output log, only appeared after with debug config set to true
	 * @param {string} text text to display in Homebridge log
	 */
	displayDebug(text){
		if(this.debug && this.prevDebugMessage[0] != text && this.prevDebugMessage[1] != text) {
			this.prevDebugMessage[1] = this.prevDebugMessage[0];
			this.prevDebugMessage[0] = text;
			this.log.info(`\x1b[2m${this.name} - ${text}\x1b[0m`);
		}
	}

	/**
	 * A helper to output log
	 * @param {string} text text to display in Homebridge log
	 */
	displayInfo(text){
		if(this.prevInfoMessage != text) {
			this.prevInfoMessage = text;
			this.log.info(`${this.name} - ${text}`);
		}
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
			exec(`${this.config.path || ""}adb start-server`, (err) => {
				if(err) {
					this.log.error(`\n\nERROR:\nCan't start ADB, make sure you already installed ADB-TOOLS in your homebridge server.\nVisit https://github.com/dwaan/homebridge-adb for ADB-TOOLS instalation guide.\n`);
				} else {
					for (let accessory of this.config.accessories) {
						if(accessory) new ADBPlugin(this.log, accessory, this.api);
					}
				}
			});
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