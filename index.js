let wol = require('wake_on_lan');
let exec = require('child_process').exec;
let Service, Characteristic;

const PLUGIN_NAME 	= 'homebridge-adb';
const PLATFORM_NAME = 'HomebridgeADB';

// ON/OFF
const ON = true;
const OFF = false;
// Yes/No
const YES = true;
const NO = false;
// Online/Offline
const ONLINE = true;
const OFFLINE = false;
// Play/Pasue
const PLAY = true;
const PAUSE = false;
// Empty
const EMPTY = "";
// App ids
const OTHER_APP_ID = "other";
const HOME_APP_ID = "home";

module.exports = (homebridge) => {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
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
		this.name = this.config.name || 'Android Accessory';
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
		this.interval = this.config.interval || 1000;
		if(this.interval < 500) this.interval = 500;
		// Show more debug
		this.debug = this.config.debug || false;
		// Exec timeout
		this.timeout = this.config.timeout || 3000;
		if(this.timeout < 1000) this.timeout = 1000;
		this.basetimeout = this.timeout;

		// Accessory status
		this.adbAccessory = {
			connecting: NO,
			initialized: NO,
			status: ONLINE,
			category: this.config.category || "TELEVISION",
			power: {
				status: OFF,
				state: OFF,
				onprogress: NO,
				onstatuschange: NO
			},
			wol: {
				onprogress: NO,
				loop: EMPTY
			},
			app: {
				id: EMPTY,
				onprogress: false
			},
			input: {
				list: this.config.inputs || [],
				hidenumber: this.config.hidenumber || false,
				hidehome: this.config.hidehome || false,
				hideother: this.config.hideother || false,
				index: 0,
				error: NO,
				useactivities: 0,
				usewindows: 0,
				onprogress: NO,
				onstatuschange: NO,
				initialized: NO
			},
			speaker: {
				create: !this.config.skipSpeaker || YES,
				initialized: NO
			},
			playback: {
				sensor: {
					create: this.config.playbacksensor || NO,
					exclude:  this.config.playbacksensorexclude || "",
					delay: this.config.playbacksensordelay || 0,
					timeout: false,
				},
				status: EMPTY,
				usetail: undefined,
				onprogress: NO
			}
		}
		this.adbAccessory.category = this.adbAccessory.category.toUpperCase();
		if(!this.adbAccessory.input.hidehome) this.adbAccessory.input.list.unshift({ "name": "Home", "id": HOME_APP_ID });
		if(!this.adbAccessory.input.hideother) this.adbAccessory.input.list.push({ "name": "Other", "id": OTHER_APP_ID });

		// Debug and Info
		this.message = {
			stdout: {
				prev: ""
			},
			info: "",
			debug: ["", ""]
		}

		// Exec statuse
		this.execStatus = [];
		this.connectCallback = EMPTY;

		/**
		 * Create the Homekit Accessories
		 */

		// generate a UUID
		const uuid = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name);
		const uuidos = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name + "OccupancySensor");

		// create the external accessory
		this.accessory = new this.api.platformAccessory(this.name, uuid);
		// create the playback sensor accesory
		if(this.adbAccessory.playback.sensor.create == YES) this.accessoryPlaybackSensor = new this.api.platformAccessory(this.name + " Playback Sensor", uuidos);

		// set the external accessory category
		if(this.adbAccessory.category == "SPEAKER")
			this.accessory.category = this.api.hap.Categories.SPEAKER;
		else if(this.adbAccessory.category == "TV_STREAMING_STICK")
			this.accessory.category = this.api.hap.Categories.TV_STREAMING_STICK;
		else if(this.adbAccessory.category == "TV_SET_TOP_BOX")
			this.accessory.category = this.api.hap.Categories.TV_SET_TOP_BOX;
		else if(this.adbAccessory.category == "AUDIO_RECEIVER")
			this.accessory.category = this.api.hap.Categories.AUDIO_RECEIVER;
		else if(this.adbAccessory.category == "APPLE_TV")
			this.accessory.category = this.api.hap.Categories.APPLE_TV;
		else
			this.accessory.category = this.api.hap.Categories.TELEVISION;

		// add the accessory service
		this.accessoryService = this.accessory.addService(Service.Television);

		// get accessory information
		this.accessoryInfo = this.accessory.getService(Service.AccessoryInformation);

		// set accessory service name
		this.accessoryService.setCharacteristic(Characteristic.ConfiguredName, this.name);
		this.accessoryService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		/**
		 * Publish as external accessory
		 * Check ADB connection before publishing the accesory
		 */

		this.displayInfo(`Initializing`);

		// Get the accessory information 
		this.getAccessoryInformations(() => {
			// Handle On Off
			this.handleOnOff();

			// Handle inputs
			this.handleInputs();

			// Handle volume
			this.handleVolume();

			// Show Control Center Remote if needed
			this.handleRemoteControl();

			// Loop the power status
			this.update();
		});
	}



	/**
	 * Get accessory information to be used in Home app as identifier
	 */
	getAccessoryInformations(callback) {
		if(this.adbAccessory.initialized == NO) {
			this.exec(`${this.path}adb -s ${this.ip} shell "getprop ro.product.model && getprop ro.product.manufacturer && getprop ro.serialno"`, (err, stdout) => {
				// Get accessory information
				if(err) stdout = ["", "", ""];
				else stdout = stdout.split("\n");

				// Create inputs
				this.createInputs();

				// Publish tv accessories
				this.createTelevision(stdout);

				// Create speaker services
				this.createTelevisionSpeakers();

				// Playback sensor
				this.createPlaybackSensor(stdout);

				if(callback) callback(stdout);

				// Display error when can't connect to accessory
				if(err) this.log.error(`\n\nWARNING:\nUnrecognized accessory - "${this.name}".\nPlease check if the accessory's IP address is correct.\nIf your accessory is turned OFF, please turn it ON.\n`);
				// Accessory finish initialzing
				else {
					this.adbAccessory.initialized = YES;
					this.displayInfo(`Accessory initialized.`);
				}
			});
		}
	}



	/**
	 * Create television accesory based on ADB information
	 * @param {string} stdout ADB output
	 */
	createTelevision(stdout) {
		this.accessoryInfo
			.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
			.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Homebridge ADB")
			.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);
		this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
		this.displayDebug(`Accessory created`);
	}

	/**
	 * Create Accessory Input Source Services
	 * These are the inputs the user can select from.
	 * When a user selected an input the corresponding Identifier Characteristic
	 * is sent to the Accessory Service ActiveIdentifier Characteristic handler.
	 * This plugins will create 50 inputs (- current inputs) unconfigured
	 * and hidden input for future modification. Home app seems have problem
	 * to add new input after initial add of the accessory. The newly
	 * created inputs will shown up as related accesorries instead of
	 * input accessories
	 */
	createInputs() {
		if(this.adbAccessory.input.list.length > 0 && this.adbAccessory.input.initialized == NO) {
			for (let i = 0; i < 50; i++) {
				let
					input = this.adbAccessory.input.list[i],
					type = Characteristic.InputSourceType.APPLICATION,
					configured = Characteristic.IsConfigured.CONFIGURED,
					targetVisibility = Characteristic.TargetVisibilityState.SHOWN,
					currentVisibility = Characteristic.CurrentVisibilityState.SHOWN,
					name = "";

				if(i == 0 && !this.adbAccessory.input.hidehome) type = Characteristic.InputSourceType.HOME_SCREEN;
				else if(i == this.adbAccessory.input.list.length - 1 && !this.adbAccessory.input.hideother) type = Characteristic.InputSourceType.OTHER;

				let humanNumber = i + 1;
				if(humanNumber < 10) humanNumber = "0" + (i + 1);

				if(i >= this.adbAccessory.input.list.length || !input.name || !input.id) {
					// Create hidden input when name and id is empty and for future modification
					configured = Characteristic.IsConfigured.NOT_CONFIGURED;
					targetVisibility = Characteristic.TargetVisibilityState.HIDDEN;
					currentVisibility = Characteristic.CurrentVisibilityState.HIDDEN;
					name = `${humanNumber}. Hidden Input`;
				} else {
					name = `${input.name}`;
					if(!this.adbAccessory.input.hidenumber) name = `${humanNumber}. ${name}`;
				}

				if(targetVisibility == Characteristic.TargetVisibilityState.SHOWN) this.displayDebug(`Input: ${name}`);
				let service = this.accessory.addService(Service.InputSource, `Input - ${name}`, i);
				service
					.setCharacteristic(Characteristic.Identifier, i)
					.setCharacteristic(Characteristic.ConfiguredName, name)
					.setCharacteristic(Characteristic.InputSourceType, type)
					.setCharacteristic(Characteristic.TargetVisibilityState, targetVisibility)
					.setCharacteristic(Characteristic.CurrentVisibilityState, currentVisibility)
					.setCharacteristic(Characteristic.IsConfigured, configured);
				this.accessoryService.addLinkedService(service);

				if(configured == Characteristic.IsConfigured.CONFIGURED) {
					this.adbAccessory.input.list[i].service = service;
				}
			};

			this.adbAccessory.input.initialized = YES;
		}
	}

	/**
	 * Create a speaker service to allow volume control
	 */
	createTelevisionSpeakers() {
		if(this.adbAccessory.speaker.create == YES) {
			this.accessoryTelevisionSpeakerService = this.accessory.addService(Service.TelevisionSpeaker);

			this.accessoryTelevisionSpeakerService
				.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
				.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE); // RELATIVE or ABSOLUTE

			this.accessoryService.addLinkedService(this.accessoryTelevisionSpeakerService);

			this.displayDebug(`Speaker created`);
		}
	}

	/**
	 * Create a playback sensor based on video playback
	 * Due to limitation of ADB, support for playback will be limited
	 */
	createPlaybackSensor(stdout) {
		if(this.adbAccessory.playback.sensor.create == YES) {
			// Add playback sensor
			this.accessoryPlaybackSensor.category = this.api.hap.Categories.SENSOR;
			this.accessoryPlaybackSensorInfo = this.accessoryPlaybackSensor.getService(Service.AccessoryInformation);
			this.accessoryPlaybackSensorService = this.accessoryPlaybackSensor.addService(Service.MotionSensor);
			this.handleMediaAsSensor();

			// Publish playback sensor
			this.accessoryPlaybackSensorInfo
				.setCharacteristic(Characteristic.Model, stdout[0] || "Android")
				.setCharacteristic(Characteristic.Manufacturer, stdout[1] || "Homebridge ADB")
				.setCharacteristic(Characteristic.SerialNumber, stdout[2] || this.ip);
			this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessoryPlaybackSensor]);
			this.displayDebug(`Sensor created`);
		}
	}



	/**
	 * Handle On/Off
	 */
	handleOnOff() {
		this.accessoryService.getCharacteristic(Characteristic.Active)
			.on('set', (state, callback) => {
				if(
					state != this.adbAccessory.power.status &&
					this.adbAccessory.power.onstatuschange == NO
				) {
					// Prevent double run
					this.adbAccessory.power.onstatuschange = YES;

					if(state) {
						// Power On
						this.adbAccessory.input.error = NO;
						this.displayInfo("Trying to turn ON accessory. This will take awhile, please wait...");
						
						if(this.mac) {
							wol.wake(`${this.mac}`, { address: `${this.ip}` }, (err) => {
								if(err) {
									this.displayInfo("Wake On LAN - Power On - Failed");
								} else {
									// Forcing accessory status on
									this.adbAccessory.wol.onprogress = YES;
									this.adbAccessory.power.status = ON;
									this.displayDebug("Wake On LAN - Power On - Success");
									// After 3 seconds,  WOL status will be reset, 
									// and let ADB get the power status from accessory
									this.adbAccessory.wol.loop = setTimeout(() => {
										this.displayDebug("Wake On LAN - Reset");
										this.adbAccessory.wol.onprogress = NO;
										this.adbAccessory.wol.loop = EMPTY;
									}, 3000);
									this.accessoryService.updateCharacteristic(Characteristic.Active, 1);
								}

								this.adbAccessory.power.onstatuschange = NO;
							});
						} else {
							this.connectCallback = () => {
								this.execOrKeycode(this.config.poweron || "KEYCODE_POWER", (err, stdout) => {
									if(err) {
										this.displayDebug("Power On - Failed");
										if(stdout) this.displayDebug("Error: " + stdout);
									} else {
										this.displayDebug("Power On - Success");
										this.connectCallback = EMPTY;
										this.accessoryService.updateCharacteristic(Characteristic.Active, 1);
										this.adbAccessory.power.onstatuschange = NO;
									}
								});
							};
							
							this.connect();
						}
					} else {
						// Power Off
						this.displayDebug("Trying to turn OFF accessory");

						this.connectCallback = EMPTY;

						this.execOrKeycode(this.config.poweroff || "KEYCODE_POWER", (err, stdout) => {
							if(err) {
								this.displayDebug("Power Off - Failed");
								if(stdout) this.displayDebug("Error: " + stdout);
							} else {
								this.displayDebug("Power Off - Success");
								this.accessoryService.updateCharacteristic(Characteristic.Active, 0);
							}

							this.adbAccessory.power.onstatuschange = NO;
						});
					}
				} 

				callback(null);
			}).on('get', (callback) => {
				callback(null, this.adbAccessory.power.status);
			});
	}

	/**
	 * Handle volume control
	 */
	handleVolume() {
		if(this.adbAccessory.speaker.create == YES) {
			// Volume control
			this.accessoryTelevisionSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
				.on('set', (state, callback) => {
					let key = state ? this.config.wolumedown || "KEYCODE_VOLUME_DOWN" : this.config.wolumeup || "KEYCODE_VOLUME_UP";

					this.execOrKeycode(key, (err) => {
						if(err) this.displayDebug(`Can't set volume`);
						else this.displayDebug(`Sending volume key`);
					});

					callback(null);
				});

			// Mute control - not implemented yet
			this.accessoryTelevisionSpeakerService.getCharacteristic(Characteristic.Mute)
				.on('get', (callback) => {
					callback(null, 0);
				})
				.on('set', (state, callback) => {
					callback(null);
				});
		}
	}

	/**
	 * Handle input change
	 */
	handleInputs() {
		if(this.adbAccessory.input.list.length > 0) {
			this.accessoryService.getCharacteristic(Characteristic.ActiveIdentifier)
				.on('set', (state, callback) => {
					if(this.adbAccessory.input.onstatuschange == NO) {
						let adb = `${this.path}adb -s ${this.ip} shell "input keyevent KEYCODE_HOME"`;

						this.adbAccessory.input.onstatuschange = YES;
						this.adbAccessory.input.index = state;

						// Accessory what kind of command that the input is
						if(this.adbAccessory.input.index != 0 && this.adbAccessory.input.list[this.adbAccessory.input.index].id != OTHER_APP_ID) {
							let type = this.adbAccessory.input.list[this.adbAccessory.input.index].id.trim();

							if(this.adbAccessory.input.list[this.adbAccessory.input.index].adb) {
								// Run specific custom ADB command
								adb = `${this.path}adb -s ${this.ip} shell "${this.adbAccessory.input.list[this.adbAccessory.input.index].adb}"`;
								this.displayDebug(`Running - ADB command - ${this.adbAccessory.input.list[this.adbAccessory.input.index].adb}`);
							} else if(!type.includes(" ") && type.includes(".")) {
								// Run app based on given valid id
								adb = `${this.path}adb -s ${this.ip} shell "monkey -p ${this.adbAccessory.input.list[this.adbAccessory.input.index].id} 1"`;
								this.displayDebug(`Running - App - ${this.adbAccessory.input.list[this.adbAccessory.input.index].id}`);
							} else {
								// Run ID as it's an ADB command
								adb = `${this.path}adb -s ${this.ip} shell "${this.adbAccessory.input.list[this.adbAccessory.input.index].id}"`;
								this.displayDebug(`Running - ${this.adbAccessory.input.list[this.adbAccessory.input.index].id}`);
							}
						}

						this.exec(adb, (err) => {
							if(err) this.displayInfo(`Can't open ${this.adbAccessory.input.list[this.adbAccessory.input.index].name}`);
							else {
								this.adbAccessory.app.id = this.adbAccessory.input.list[this.adbAccessory.input.index].id;
								this.accessoryService.updateCharacteristic(Characteristic.ActiveIdentifier, this.adbAccessory.input.index);
								this.displayInfo(`Current app: ${this.adbAccessory.input.list[this.adbAccessory.input.index].name}`);
							}

							this.adbAccessory.input.onstatuschange = NO;
						});
					}

					callback(null);
				});
		}
	}

	/**
	 * Handle playback sensor
	 */
	handleMediaAsSensor() {
		this.accessoryPlaybackSensorService.getCharacteristic(Characteristic.MotionDetected)
			.on('get', (callback) => {
				var state = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
				if(this.adbAccessory.playback.status) state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;

				callback(null, state);
			});
	}

	/**
	 * Handle control center remote controll
	 */
	handleRemoteControl() {
		// handle [remote control]
		this.accessoryService.getCharacteristic(Characteristic.RemoteKey)
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
						key = this.config.upbutton || 'KEYCODE_DPAD_UP';
						break;
					}
					case Characteristic.RemoteKey.ARROW_DOWN: {
						key = this.config.downbutton || 'KEYCODE_DPAD_DOWN';
						break;
					}
					case Characteristic.RemoteKey.ARROW_LEFT: {
						key = this.config.leftbutton || 'KEYCODE_DPAD_LEFT';
						break;
					}
					case Characteristic.RemoteKey.ARROW_RIGHT: {
						key = this.config.rightbutton || 'KEYCODE_DPAD_RIGHT';
						break;
					}
					case Characteristic.RemoteKey.SELECT: {
						key = this.config.selectbutton || 'KEYCODE_ENTER';
						break;
					}
					case Characteristic.RemoteKey.BACK: {
						key = this.config.backbutton || 'KEYCODE_BACK';
						break;
					}
					case Characteristic.RemoteKey.EXIT: {
						key = 'KEYCODE_HOME';
						break;
					}
					case Characteristic.RemoteKey.PLAY_PAUSE: {
						key = this.config.playpausebutton || 'KEYCODE_MEDIA_PLAY_PAUSE';
						break;
					}
					case Characteristic.RemoteKey.INFORMATION: {
						key = this.config.infobutton || 'KEYCODE_INFO';
						break;
					}
				}

				this.execOrKeycode(key, (err) => {
					if(err) this.displayDebug(`Remote Control - Can't send: ${key}`);
					else this.displayDebug(`Remote Control - Sending: ${key}`);
				});
				callback(null);
			});
	}



	/**
	 * Check whether to use tail or head for more optimized output
	 */
	checkTail() {
		if(this.adbAccessory.playback.usetail === undefined) this.exec(`${this.path}adb -s ${this.ip} shell "tail --help"`, (err) => {
			if(err) this.adbAccessory.playback.usetail = NO;
			else this.adbAccessory.playback.usetail = YES;
		});
	}

	/**
	 * Check if a video is playing
	 */
	checkPlayback() {
		if(this.adbAccessory.playback.sensor.create == YES) {
			// Check if accessory have tail and head command
			this.checkTail();

			var changed = false;
			var state = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
			var tail = this.adbAccessory.playback.usetail === true ? " | tail -1" : "";

			if(this.adbAccessory.power.status == OFF) {
				// When accessory is asleep, set the sensor off
				if(this.adbAccessory.playback.status == PLAY) {
					this.displayDebug(`Playback sensor is OFF when accessory is OFF`);
					this.adbAccessory.playback.status = PAUSE;
					this.accessoryPlaybackSensorService.updateCharacteristic(Characteristic.MotionDetected, state);
				}
			} else if(this.adbAccessory.playback.onprogress == NO && this.adbAccessory.app.id && !this.adbAccessory.playback.sensor.exclude.includes(this.adbAccessory.app.id)) {
				var changeState = (state, type, stdout) => {
					if(changed) {
						this.adbAccessory.playback.sensor.timeout = setTimeout(() => {
							if(stdout) {
								this.displayDebug(`Playback - ${type} - ${stdout}`);
								this.displayDebug(`Current playback app id - ${this.adbAccessory.app.id}`);
								this.displayInfo(`Playback sensor status - ${this.adbAccessory.playback.status ? "ON" : "OFF"}`);
							}
							this.accessoryPlaybackSensorService.updateCharacteristic(Characteristic.MotionDetected, state);
						}, this.adbAccessory.playback.sensor.delay);
					}

					this.adbAccessory.playback.onprogress = NO;	
				}
				var errorState = (using) => {
					if(this.adbAccessory.playback.status === PLAY || this.adbAccessory.playback.status === EMPTY) {
						this.displayDebug(`Playback error using ${using}`);

						this.adbAccessory.playback.status = PAUSE;
						changed = true;
					}
				}
				
				this.adbAccessory.playback.onprogress = YES;
				
				this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys media_session | grep -e 'Media button session is' -e 'AlexaMediaPlayerRuntime'"`, (err, stdout) => {
					if(err) {
						this.displayDebug(`Can't check for Playback status`);
					} else if(this.adbAccessory.app.id == HOME_APP_ID || this.adbAccessory.app.id != OTHER_APP_ID || stdout.includes(this.adbAccessory.app.id) || stdout.includes('AlexaMediaPlayerRuntime')) {
						this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys media_session | grep 'state=PlaybackState'"`, (err, stdout) => {
							if(err) errorState('media_session');
							else {
								if(stdout === EMPTY) {
									this.displayDebug(`checkPlayback - media_session - no audio playing?`);
								} else {
									if(stdout.includes("state=3")) {
										if(this.adbAccessory.playback.status == PAUSE) {
											state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
											this.adbAccessory.playback.status = PLAY;
											changed = true;
										}
									} else if(this.adbAccessory.playback.status == PLAY) {
										this.adbAccessory.playback.status = PAUSE;
										changed = true;
									}
								}
							}

							changeState(state, 'media_session', stdout);
						});
					} else {					
						this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys audio | grep 'player piid:' | grep ' state:' ${tail}"`, (err, stdout) => {
							// After restart, android accessory will display error when running this command
							if(err) errorState('audio');
							else {
								if(stdout === EMPTY) {
									this.displayDebug(`checkPlayback - audio - no audio playing?`);
								} else {
									stdout = stdout.split("\n");
									stdout = stdout[stdout.length - 1].trim();

									if(stdout.includes("state:started")) {
										if(this.adbAccessory.playback.status == PAUSE) {
											state = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
											this.adbAccessory.playback.status = PLAY;
											changed = true;
										}
									} else if(this.adbAccessory.playback.status == PLAY) {
										this.adbAccessory.playback.status = PAUSE;
										changed = true;
									}
								}
							}

							changeState(state, 'audio', stdout);
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
			if(!stdout || stdout == "") return -1;

			if(stdout != this.message.stdout.prev) {
				let otherApp = true;

				this.message.stdout.prev = stdout;

				// Identified current focused app
				if(stdout) {
					stdout = stdout.trim().split("/");
					stdout[0] = stdout[0].split(" ");
					stdout[0] = stdout[0][stdout[0].length - 1];

					if(stdout[0] == undefined) stdout[0] = HOME_APP_ID;
					if(stdout[1] == undefined) stdout[1] = "";

					if(!this.adbAccessory.input.hidehome && (stdout[1].includes("Launcher") || stdout[1].substr(0, 13) == ".MainActivity" || stdout[1].includes("RecentsTvActivity"))) stdout = this.adbAccessory.input.list[0].id;
					else stdout = stdout[0];
				} else stdout = OTHER_APP_ID;

				if(this.adbAccessory.input.list.length > 0) {
					// Checking if it's a Home or registered app
					if(stdout != this.adbAccessory.input.list[this.adbAccessory.input.index].id) {
						this.adbAccessory.input.list.forEach((input, i) => {
							if(stdout == input.id) {
								this.adbAccessory.input.index = i;
								otherApp = false;
							}
						});

						// Other app, extract human readable name from app id
						if(otherApp && !this.adbAccessory.input.hideother) {
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

							this.adbAccessory.input.index = this.adbAccessory.input.list.length - 1;
							if(this.adbAccessory.input.list[this.adbAccessory.input.index]) this.adbAccessory.input.list[this.adbAccessory.input.index].id = stdout;
							if(this.adbAccessory.input.list[this.adbAccessory.input.index].service) {
								if(!this.adbAccessory.input.hidenumber) humanName = `${this.adbAccessory.input.index + 1}. ${humanName}`;
								this.adbAccessory.input.list[this.adbAccessory.input.index].service.updateCharacteristic(Characteristic.ConfiguredName, `${humanName}`);
							}
						}
					}

					if(this.adbAccessory.app.id != stdout) {
						this.adbAccessory.app.id = stdout;
						
						// Set the accessory input to current selected app
						this.accessoryService.updateCharacteristic(Characteristic.ActiveIdentifier, this.adbAccessory.input.index);
						this.displayInfo(`Current app id - \x1b[4m${this.adbAccessory.app.id}\x1b[0m`);
					}
				}
			}

			return 1;
		}

		if(this.adbAccessory.power.status == ON && this.adbAccessory.input.onprogress == NO && this.adbAccessory.input.onstatuschange == NO) {
			this.adbAccessory.input.onprogress = YES;

			// Check if ADB can use dumpsys window
			if(this.adbAccessory.input.usewindows >= 0) {
				this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys window windows | grep -E mFocusedApp"`, (err, stdout) => {
					if(err) {
						this.displayDebug(`Check Input - Error while using "dumpsys window"`);
						this.adbAccessory.input.usewindows = -1;
					} else {
						this.displayDebug(`Check Input - Using "dumpsys window"`);
						this.adbAccessory.input.usewindows = parseInput(stdout);
					}

					this.adbAccessory.input.onprogress = NO;
				});
			} 

			// Check if ADB can use dumpsys activity
			if(this.adbAccessory.input.usewindows < 0 && this.adbAccessory.input.useactivities >= 0) {
				this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys activity activities | grep ' ResumedActivity'"`, (err, stdout) => {
					if(err) {
						this.displayDebug(`Check Input - Error while using "dumpsys activity"`);
						this.adbAccessory.input.useactivities = -1;
					} else {
						this.displayDebug(`Check Input - Using "dumpsys activity"`);
						this.adbAccessory.input.useactivities = parseInput(stdout);
					}

					this.adbAccessory.input.onprogress = NO;
				});
			}
			
			// If can't use both display error.
			if(this.adbAccessory.input.useactivities < 0 && this.adbAccessory.input.usewindows < 0 && this.adbAccessory.input.error == YES) {
				this.adbAccessory.input.error = YES;
				that.displayInfo(`Can't read current app from accessory.`);
			}
		}
	}

	/**
	 * Check if accessory is on based on screen status
	 * @param {function} callback a function to run after finish executing ADB
	 */
	checkPower() {
		if(
			this.adbAccessory.wol.onprogress == NO && 
			this.adbAccessory.power.onprogress == NO && 
			this.adbAccessory.power.onstatuschange == NO
		) {
			this.adbAccessory.power.onprogress = YES;

			this.exec(`${this.path}adb -s ${this.ip} shell "dumpsys power | grep mHoldingDisplay"`, (err, stdout) => {
				if(err) {
					// When adb command can't be execute, set it to off
					if(this.adbAccessory.power.status == ON) {
						this.adbAccessory.power.status = OFF;
						this.displayInfo(`Accessory is OFF.`);
					}
				} else {
					// check power status from accessory
					stdout = stdout.split('=')[1] == 'true' ? ON : OFF;
					if(stdout != this.adbAccessory.power.status) {
						this.connectCallback = EMPTY;
						this.adbAccessory.power.status = stdout;
						this.displayInfo(`Accessory is ${this.adbAccessory.power.status ? "ON." : "OFF."}`);
					}

					if(this.adbAccessory.power.status == ON) this.connectCallback = EMPTY;
				}

				this.adbAccessory.power.onprogress = NO;

				// Update accessory power status
				this.accessoryService.updateCharacteristic(Characteristic.Active, this.adbAccessory.power.status);
			});
		}
	}



	/**
	 * Connect to the accessory
	 */
	connect() {
		if(this.adbAccessory.connecting == NO) {
			this.displayDebug(`Reconnecting...`);
			this.adbAccessory.connecting = YES;

			// Special, doesn't use costum exec
			exec(`${this.path}adb connect ${this.ip}`, { timeout: this.timeout }, (err, stdout, stderr) => {
				var message = "";

				stdout = stdout.trim() || stderr.trim();
				if(stdout.includes(`device still authorizing`)) 		message = `Accessory still authorizing. Please wait...`;
				else if(stdout.includes(`device unauthorized.`)) 		message = `Unauthorized accessory. Please check your device for authorization.`;
				else if(stdout.includes(`Connection refused`)) {
					message = `Connection refused. Accessory disconnected or turned off. Reconnecting...`;
					// When ADB server get killed, "adb connect" will return 
					// the connection in approx. 7 seconds
					this.timeout = 10000;
				} 
				// else if(stdout.includes(`Connection reset by peer`)) 	message = `Connection resetted. You might need to "Revoke USB debugging authorizations" in you Android device and restart plugins.`;
				else if(stdout.includes(`Operation timed out`))			message = `Connection timeout. Reconnecting...`
				else if(err || stdout.includes(`failed to connect`)) 	message = `Accessory disconnected or turned off. Reconnecting...`;
				else if(!stdout.includes(`already connected`))			this.displayDebug(stdout);
				
				if(message) {
					this.displayInfo(`${message}`);
						
					// Accessory is offline
					this.adbAccessory.status = OFFLINE;

				} else {
					// Return to the base timeout
					this.timeout = this.basetimeout;

					// Set it online
					this.adbAccessory.status = ONLINE;

					this.displayDebug(`Reconnected`);
				}

				if(this.connectCallback != EMPTY) this.connectCallback();
				this.adbAccessory.connecting = NO;
			});
		}
	}

	/**
	 * The main loop to check accessory power, input, and playback status.
	 */
	update() {
		// Update accessory status every second -> or based on configuration
		this.intervalHandler = setInterval(() => {
			if(this.adbAccessory.status == OFFLINE) {
				// Reconnecting
				this.connect();
			} else {
				// Check power
				this.checkPower();

				// Check input
				this.checkInput();

				// Check playback
				this.checkPlayback();
			}
		}, this.interval);
	}



	/**
	 * A helper for executing ADB keycode command or custom shell executable
	 * @param {string} command the shell command
	 * @param {function} callback callback when command succesully executed
	 */
	execOrKeycode(command, callback) {
		this.execOrKeycodeWithTimeout(command, this.timeout, callback);
	}

	/**
	 * A helper for executing ADB keycode command or custom shell executable with custom timeout
	 * @param {string} command the shell command
	 * @param {int} timeout timeout in miliseconds
	 * @param {function} callback callback when command succesully executed
	 */
	execOrKeycodeWithTimeout(command, timeout, callback) {
		let finalCommand = "";
		command = command.split(" ");

		if(command[0].toLowerCase() == "shell") {
			// Command is a shell script
			this.displayDebug("Sending shell script");
			for(let i = 1; i < command.length; i++) {
				finalCommand += `${command[i]} `;
			}
		} else {
			// Command is keycode
			let keys = "";
			for(let i = 0; i < command.length; i++) {
				finalCommand += `input keyevent ${command[i]}`;
				keys += `${command[i]}`;
				if (i < command.length - 1) {
					keys += ` + `;
					finalCommand += ` && `;
				}
			}
			this.displayDebug(`Sending adb keycode: "${keys}"`);
			finalCommand = `${this.path}adb -s ${this.ip} shell "${finalCommand}"`
		}

		this.execWithTimeout(finalCommand, timeout, callback);
	}

	/**
	 * A helper for executing ADB command
	 * @param {string} cmd the shell command
	 * @param {function} callback callback when command succesully executed
	 */
	exec(cmd, callback) {
		this.execWithTimeout(cmd, this.timeout, callback);
	}

	/**
	 * A helper for executing ADB command
	 * @param {string} cmd the shell command
	 * @param {int} timeout timeout in miliseconds
	 * @param {function} callback callback when command succesully executed
	 */
	execWithTimeout(cmd, timeout, callback) {
		// Same commands will only run one at a time
		if(!this.execStatus[cmd] || cmd.includes("input keyevent")) {
			this.execStatus[cmd] = true;

			exec(cmd, { timeout: timeout, maxBuffer: 500 }, (err, stdout, stderr) => {
				stdout = stdout.trim() || stderr.trim();

				if(
					err ||
					stdout.includes(`error: device '${this.ip}' not found`) || 
					stdout.includes(`error: closed`) || 
					stdout.includes(`error: device offline`)
				) {
					if(stdout) this.adbAccessory.status = OFFLINE;
					if(callback) callback(true, stdout);
				} else {
					this.adbAccessory.status = ONLINE;
					if(callback) callback(stdout.includes(`Operation timed out`), stdout);
				}

				this.execStatus[cmd] = false;
			});
		}
	}



	/**
	 * A helper to output log, only appeared after with debug config set to true
	 * @param {string} text text to display in Homebridge log
	 */
	displayDebug(text){
		if(this.debug && this.message.debug[0] != text && this.message.debug[1] != text) {
			this.message.debug[1] = this.message.debug[0];
			this.message.debug[0] = text;
			this.log.info(`\x1b[2m${this.name} - ${text}\x1b[0m`);
		}
	}

	/**
	 * A helper to output log
	 * @param {string} text text to display in Homebridge log
	 */
	displayInfo(text){
		if(this.message.info != text) {
			this.message.info = text;
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
			exec(`${this.config.path || ""}adb start-server`, (err, stdout) => {
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