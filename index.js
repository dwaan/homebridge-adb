let wol = require('wake_on_lan');
let adb = require('nodejs-adb-wrapper');
let Service, Characteristic;

const PLUGIN_NAME = 'homebridge-adb';
const PLATFORM_NAME = 'HomebridgeADB';

// Yes/No
const YES = true;
const NO = false;
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
		if (!config) return;

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
		if (!this.ip) {
			this.log.error(`\n\nPlease provide IP for this accessory: ${this.name}\n`);
			return;
		}
		// Mac
		this.mac = this.config.mac || "";
		// Interval
		this.interval = this.config.interval || 2500;
		if (this.interval < 500) this.interval = 500;
		// Show more debug
		this.debug = this.config.debug || false;
		// Exec timeout
		this.timeout = this.config.timeout || 2500;
		if (this.timeout < 1000) this.timeout = 1000;

		// Inputs
		this.input = this.config.inputs || [];
		this.inputOnChange = NO;
		this.inputIndex = 0;
		this.hidenumber = this.config.hidenumber || false;
		this.hideHome = this.config.hidehome || false;
		this.hideOther = this.config.hideother || false;
		if (!this.hideHome) this.input.unshift({ "name": "Home", "id": HOME_APP_ID });
		if (!this.hideOther) this.input.push({ "name": "Other", "id": OTHER_APP_ID });
		// Category
		this.category = this.config.category || "TELEVISION";
		this.category = this.category.toUpperCase();
		// Speaker
		this.enableSpeaker = !this.config.skipSpeaker || YES;
		// Playback Sensor
		this.isPlaying = NO;
		this.enablePlaybackSensor = this.config.playbacksensor || NO;
		this.playbackSensorDelayOff = this.config.playbacksensordelay || 10000;
		this.playbackSensorExclude = this.config.playbacksensorexclude || "";
		// State detection
		this.stateAdbCommand = this.config.stateAdbCommand;
		this.stateAdbOutputAwake = this.config.stateAdbOutputAwake;
		// Power
		this.powerOnChange = NO;
		this.wolLoop = EMPTY;
		this.retryPowerOn = this.retrypoweron || 10;
		// App
		this.currentAppID = HOME_APP_ID;
		// Custom launcher app id
		this.launcherid = this.config.launcherid;

		// Accessory status
		this.adb = new adb(this.ip, {
			path: this.path,
			interval: this.interval,
			timeout: this.timeout,
			playbackDelayOff: this.playbackSensorDelayOff,
			retryPowerOn: this.retryPowerOn,
			keycodePowerOn: this.config.poweron,
			keycodePowerOff: this.config.poweroff,
			stateAdbCommand: this.stateAdbCommand,
			stateAdbOutputAwake: this.stateAdbOutputAwake,
			launcherid: this.launcherid
		});

		/**
		 * Create the Homekit Accessories
		 */

		// generate a UUID
		const uuid = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name);
		const uuidos = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name + "OccupancySensor");
		const uuidsi = this.api.hap.uuid.generate('homebridge:adb-plugin' + this.ip + this.name + "SwitchInput");

		// create the external accessory
		this.accessory = new this.api.platformAccessory(this.name, uuid);
		// create the playback sensor accessory
		if (this.enablePlaybackSensor == YES) this.accessoryPlaybackSensor = new this.api.platformAccessory(this.name + " Playback Sensor", uuidos);
		// create switch input
		this.switchInputs = new this.api.platformAccessory(this.name + " Switch Inputs", uuidsi);
		this.switchInputsArray = [];
		this.switchInputsService = this.switchInputs.addService(Service.Switch);

		// set the external accessory category
		switch (this.category) {
			case "SPEAKER":
				this.accessory.category = this.api.hap.Categories.SPEAKER;
				break;
			case "TV_STREAMING_STICK":
				this.accessory.category = this.api.hap.Categories.TV_STREAMING_STICK;
				break;
			case "TV_SET_TOP_BOX":
				this.accessory.category = this.api.hap.Categories.TV_SET_TOP_BOX;
				break;
			case "AUDIO_RECEIVER":
				this.accessory.category = this.api.hap.Categories.AUDIO_RECEIVER;
				break;
			case "APPLE_TV":
				this.accessory.category = this.api.hap.Categories.APPLE_TV;
				break;
			default:
				this.accessory.category = this.api.hap.Categories.TELEVISION;
				break;
		}

		// add the accessory service
		this.accessoryService = this.accessory.addService(Service.Television);

		// get accessory information
		this.accessoryInfo = this.accessory.getService(Service.AccessoryInformation);

		// set accessory service name
		this.accessoryService.setCharacteristic(Characteristic.ConfiguredName, this.name);
		this.accessoryService.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

		/**
		 * Publish as external accessory
		 * Check ADB connection before publishing the accessory
		 */

		this.displayInfo(`Initializing`);

		// Get device information
		this.createAccessories().then(() => {
			// Get the accessory information
			this.adb.update().catch(error => {
				if (error) this.displayDebug(`Update error message:\n${error}`);
			});

			// Handle On Off
			this.handleOnOff();

			// Handle inputs
			this.handleInputs();

			// Handle volume
			this.handleVolume();

			// Show Control Center Remote if needed
			this.handleRemoteControl();

			// Loop events
			let count = 0;
			this.adb.on(`update`, (type, message, debug) => {
				switch (type) {
					case `firstrun`:
						break;
					// Connection events
					case `connecting`:
						this.displayDebug("Connecting...");
						break;
					case `timeout`:
						this.displayDebug("Timeout...");
						break;
					case `status`:
						if (count++ == 0) this.displayDebug(`Alive: ${Date()}`);
						if (count >= 60) count = 0;
						break;
					case `connected`:
						this.displayDebug("Connected");
						break;
					case `disconnected`:
						this.displayDebug("Not connected");
						break;
					case `authorized`:
						this.displayDebug("Authorized");
						break;
					case `unauthorized`:
						this.displayInfo(`\n\n\t${this.red("WARNING: Device unauthorized")}.\n\tCheck your Android device for authorization popup.\n`);
						break;

					// App events
					case `appChange`:
						const currentAppId = this.adb.getCurrentAppId();

						this.displayDebug(`App change to ${currentAppId}`);
						this.parseInput(currentAppId);

						this.switchInputs.currentId = currentAppId;
						this.switchInputs.turnOn(`from app change event`);
						break;
					case `playback`:
						if (this.enablePlaybackSensor == YES) {
							if (this.isPlaying == this.adb.getPlaybackStatus()) return;

							this.isPlaying = this.playbackSensorExclude.includes(this.currentAppID) ? NO : this.adb.getPlaybackStatus() ? YES : NO;
							this.displayInfo(`Playback - ${this.isPlaying ? this.green(`On`) : this.red(`Off`)}`);
							this.accessoryPlaybackSensorService.updateCharacteristic(Characteristic.MotionDetected, this.isPlaying);
							if (debug) this.displayDebug("Playback debug:\n" + debug.trim());
						}
						break;

					// Sleep/awake events
					case `awake`:
						this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
						this.displayInfo(this.green(`Awake`));
						break;
					case `sleep`:
						this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
						this.displayInfo(this.red(`Sleep`));
						break;

					// Power events
					case `powerOn`:
						this.displayDebug(`Turning power on`);
						break;
					case `powerOff`:
						this.displayDebug(`Turning power off`);
						break;
					case `debugPowerOn`:
						this.displayDebug(`Turning power on: ${message.awake}, ${debug}`);
						break;
					case `debugPowerOff`:
						this.displayDebug(`Turning power off: ${message.awake}, ${debug}`);
						break;
					case `powerOnStatus`:
						this.displayDebug(`Turning power on: ${message}`);
						break;
					case `powerOffStatus`:
						this.displayDebug(`Turning power off: ${message}`);
						break;

					default:
						break;
				}
			});
		});
	}



	/**
	 * Get accessory information to be used in Home app as identifier
	 */
	async createAccessories() {
		if (!this.adb.isConnected()) await this.adb.connect();
		let { result, message } = await this.adb.model();

		// Get accessory information
		if (!result) message = ["", "", ""];
		else message = message.split(" | ");

		// Create inputs
		this.createInputs();
		this.createSwitchInputs();

		// Publish tv accessories
		this.createTV(message);

		// Create speaker services
		this.createTVSpeakers();

		// Playback sensor
		this.createPlaybackSensor(message);

		// Display error when can't connect to accessory
		if (!result) this.log.error(`\n\nWARNING:\nUnrecognized accessory - "${this.name}".\nPlease check if the accessory's IP address is correct.\nIf your accessory is turned OFF, please turn it ON.\n`);
		// Accessory finish initialzing
		else this.displayInfo(`\x1B[01;93mAccessory initialized.\x1B[0m`);
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
		if (this.input.length <= 0) return;

		for (let i = 0; i < 50; i++) {
			let input = this.input[i];
			let type = Characteristic.InputSourceType.APPLICATION;
			let configured = Characteristic.IsConfigured.CONFIGURED;
			let targetVisibility = Characteristic.TargetVisibilityState.SHOWN;
			let currentVisibility = Characteristic.CurrentVisibilityState.SHOWN;
			let name = "";

			if (i == 0 && !this.hideHome) type = Characteristic.InputSourceType.HOME_SCREEN;
			else if (i == this.input.length - 1 && !this.hideOther) type = Characteristic.InputSourceType.OTHER;

			let humanNumber = i + 1;
			if (humanNumber < 10) humanNumber = "0" + (i + 1);

			if (i >= this.input.length || !input.name || !input.id) {
				// Create hidden input when name and id is empty and for future modification
				configured = Characteristic.IsConfigured.NOT_CONFIGURED;
				targetVisibility = Characteristic.TargetVisibilityState.HIDDEN;
				currentVisibility = Characteristic.CurrentVisibilityState.HIDDEN;
				name = `${humanNumber} Hidden Input`;
			} else {
				name = `${input.name}`;
				if (!this.hidenumber) name = `${humanNumber} ${name}`;
			}

			if (targetVisibility == Characteristic.TargetVisibilityState.SHOWN) this.displayDebug(`📺 Input: ${name}`);
			let service = this.accessory.addService(Service.InputSource, `Input ${name}`, i);
			service
				.setCharacteristic(Characteristic.Identifier, i)
				.setCharacteristic(Characteristic.ConfiguredName, name)
				.setCharacteristic(Characteristic.InputSourceType, type)
				.setCharacteristic(Characteristic.TargetVisibilityState, targetVisibility)
				.setCharacteristic(Characteristic.CurrentVisibilityState, currentVisibility)
				.setCharacteristic(Characteristic.IsConfigured, configured);
			this.accessoryService.addLinkedService(service);

			if (configured == Characteristic.IsConfigured.CONFIGURED) {
				this.input[i].service = service;
			}
		};
	}

	/**
	 * Create a playback sensor based on video playback
	 * Due to limitation of ADB, support for playback will be limited
	 * @param {string} output ADB output
	 */
	createSwitchInputs() {
		if (this.input.length <= 0) return;

		this.switchInputs.currentId = this.adb.getCurrentAppId();
		this.switchInputs.add = service => {
			this.switchInputsArray.push(service);
		}
		this.switchInputs.turnOn = (trace = 'from unknown') => {
			this.switchInputsArray.forEach(accessory => {
				accessory.updateCharacteristic(Characteristic.On, accessory.id == this.switchInputs.currentId ? YES : NO);
			});
			this.displayDebug(`🎚️ Updating switches`, trace, this.switchInputs.currentId);
		}

		for (let i = 0; i < this.input.length; i++) {
			const input = this.input[i];
			const name = `${input.name}`;

			if (input.switch) {
				let service = this.accessory.addService(Service.Switch, `${name}`, i)
					.setCharacteristic(Characteristic.Name, name)
				service.id = input.id;
				this.handleSwitchInput(service);
				this.switchInputsService.addLinkedService(service);
				this.switchInputs.add(service);

				this.displayDebug(`🎚️ Switch: ${name}`);
			}
		}
	}

	/**
	 * Create television accessory based on ADB information
	 * @param {string} output ADB output
	 */
	createTV(output) {
		this.accessoryInfo
			.setCharacteristic(Characteristic.Model, output[0] || "Android TV")
			.setCharacteristic(Characteristic.Manufacturer, output[1] || "Homebridge ADB")
			.setCharacteristic(Characteristic.SerialNumber, output[2] || this.ip);
		this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
		this.displayDebug(`TV created`);
	}

	/**
	 * Create a speaker service to allow volume control
	 */
	createTVSpeakers() {
		if (this.enableSpeaker == NO) return;

		this.accessoryTVSpeakerService = this.accessory.addService(Service.TelevisionSpeaker);
		this.accessoryTVSpeakerService
			.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
			.setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE);
		this.accessoryService.addLinkedService(this.accessoryTVSpeakerService);
		this.displayDebug(`Speaker created`);
	}

	/**
	 * Create a playback sensor based on video playback
	 * Due to limitation of ADB, support for playback will be limited
	 * @param {string} output ADB output
	 */
	createPlaybackSensor(output) {
		if (this.enablePlaybackSensor == NO) return;

		// Add playback sensor
		this.accessoryPlaybackSensor.category = this.api.hap.Categories.SENSOR;
		this.accessoryPlaybackSensorInfo = this.accessoryPlaybackSensor.getService(Service.AccessoryInformation);
		this.accessoryPlaybackSensorService = this.accessoryPlaybackSensor.addService(Service.MotionSensor);
		this.handleMediaAsSensor();

		// Publish playback sensor
		this.accessoryPlaybackSensorInfo
			.setCharacteristic(Characteristic.Model, output[0] || "Android")
			.setCharacteristic(Characteristic.Manufacturer, output[1] || "Homebridge ADB")
			.setCharacteristic(Characteristic.SerialNumber, output[2] || this.ip);
		this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessoryPlaybackSensor]);
		this.displayDebug(`Sensor created`);
	}



	/**
	 * Handle On/Off
	 */
	handleOnOff() {
		this.accessoryService.getCharacteristic(Characteristic.Active)
			.onSet(state => {
				if (state == this.adb.getPowerStatus() || this.powerOnChange == YES) return;

				this.powerOnChange = YES;

				if (state) {
					// Power On
					this.displayDebug("Trying to turn ON accessory. This will take awhile, please wait...");

					if (this.mac) {
						this.displayDebug("Wake On LAN - Sending magic");
						wol.wake(`${this.mac}`, wol.WakeOptions, error => {
							this.adb.state().then(({ result, message }) => {
								if (error) throw error;
								if (!result) throw message;

								this.powerOnChange = NO;
								this.displayDebug("Wake On LAN - Success");

								this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
							}).catch(error => {
								this.powerOnChange = NO;
								this.displayInfo("Wake On LAN - Failed");

								this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);

								if (error) this.displayDebug(`WOL error message:\n${error}`);
							});
						});
					} else {
						this.adb.powerOn().then(({ result, message }) => {
							if (!result) throw message;

							this.powerOnChange = NO;
							this.displayDebug("Power On - Success");

							this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);
						}).catch(error => {
							this.powerOnChange = NO;
							this.displayInfo("Power On - Failed");

							this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);

							if (error) this.displayDebug(`Power on error message: ${error}`);
						});
					}
				} else {
					// Power Off
					this.displayDebug("Trying to turn OFF accessory");

					this.adb.powerOff().then(({ result, message }) => {
						if (!result) throw message;

						this.powerOnChange = NO;
						this.displayDebug("Power Off - Success");

						this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
					}).catch(error => {
						this.powerOnChange = NO;
						this.displayInfo("Power Off - Failed");

						this.accessoryService.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE);

						if (error) this.displayDebug(`Power off error message: ${error}`);
					});
				}
			}).onGet(() => this.adb.getPowerStatus() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
	}

	/**
	 * Handle volume control
	 */
	handleVolume() {
		if (this.enableSpeaker == NO) return;

		this.accessoryTVSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
			.onSet(state => {
				this.adb.sendKeycode(state ? this.config.volumedown || "KEYCODE_VOLUME_DOWN" : this.config.volumeup || "KEYCODE_VOLUME_UP").then(({ result, message }) => {
					if (!result) throw message;
					this.displayDebug(`Volume - ${state ? 'Increased' : 'Decreased'}`);
				}).catch(error => {
					this.displayDebug(`Volume - Failed`);
					if (error) this.displayDebug(`Volume error message:\n${error}`);
				});
			});
	}

	/**
	 * Handle input change
	 */
	handleInputs() {
		if (this.input.length <= 0) return;

		this.accessoryService.getCharacteristic(Characteristic.ActiveIdentifier)
			.onSet(state => {
				if (this.inputOnChange == YES) return;

				let adb = "input keyevent KEYCODE_HOME";

				this.inputOnChange = YES;

				// Accessory what kind of command that the input is
				if (this.input[state].id != HOME_APP_ID && this.input[state].id != OTHER_APP_ID) {
					let type = this.input[state].id.trim();
					adb = this.input[state].adb;

					if (!adb && !type.includes(" ") && type.includes(".")) adb = type;
				}

				this.adb.launchApp(adb).then(({ result, message }) => {
					if (!result) throw message;

					this.inputIndex = state;
					this.accessoryService.updateCharacteristic(Characteristic.ActiveIdentifier, state < 0 ? 0 : state);

					this.inputOnChange = NO;
					this.displayInfo(`Input - Current app: ${this.input[state].id}`);
				}).catch(error => {
					this.inputOnChange = NO;
					this.displayInfo(`Input - Can't open: ${this.input[state].id}`)
					if (error) this.displayDebug(`Launch error message:\n${error}`);
				});
			})
			.onGet(() => this.inputIndex);
	}

	/**
	 * Handle control center remote controll
	 */
	handleSwitchInput(switchInput) {
		if (!switchInput) return;

		const index = switchInput.subtype;

		switchInput.getCharacteristic(Characteristic.On)
			.onSet(state => {
				if (this.inputOnChange == YES) return;

				const appId = this.input[index].id.trim();
				let adb = "input keyevent KEYCODE_HOME";

				this.inputOnChange = YES;

				if (state) {
					// Accessory what kind of command that the input is
					adb = this.input[index].adb;

					if (!adb && !appId.includes(" ") && appId.includes(".")) adb = appId;
				}

				this.adb.launchApp(adb).then(({ result, message }) => {
					if (!result) throw message;

					this.switchInputs.currentId = this.adb.getCurrentAppId();
					this.switchInputs.turnOn(`from switches handle`);

					this.inputOnChange = NO;
					this.displayInfo(`Switch - Current app: ${appId}`);
				}).catch(error => {
					this.inputOnChange = NO;
					this.displayInfo(`Switch - Can't open: ${appId}`);
					if (error) this.displayDebug(`Launch error message:\n${error}`);
				});
			})
			.onGet(() => this.adb.getPowerStatus() ? this.switchInputs.currentId == switchInput.id ? true : false : false);
	}

	/**
	 * Handle playback sensor
	 */
	handleMediaAsSensor() {
		this.accessoryPlaybackSensorService.getCharacteristic(Characteristic.MotionDetected)
			.onGet(() => this.isPlaying);
	}

	/**
	 * Handle control center remote control
	 */
	handleRemoteControl() {
		this.accessoryService.getCharacteristic(Characteristic.RemoteKey)
			.onSet(state => {
				var key = "KEYCODE_HOME";

				switch (state) {
					case Characteristic.RemoteKey.REWIND:
						key = 'KEYCODE_MEDIA_REWIND';
						break;
					case Characteristic.RemoteKey.FAST_FORWARD:
						key = 'KEYCODE_MEDIA_FAST_FORWARD';
						break;
					case Characteristic.RemoteKey.NEXT_TRACK:
						key = 'KEYCODE_MEDIA_NEXT';
						break;
					case Characteristic.RemoteKey.PREVIOUS_TRACK:
						key = 'KEYCODE_MEDIA_PREVIOUS';
						break;
					case Characteristic.RemoteKey.ARROW_UP:
						key = this.config.upbutton || 'KEYCODE_DPAD_UP';
						break;
					case Characteristic.RemoteKey.ARROW_DOWN:
						key = this.config.downbutton || 'KEYCODE_DPAD_DOWN';
						break;
					case Characteristic.RemoteKey.ARROW_LEFT:
						key = this.config.leftbutton || 'KEYCODE_DPAD_LEFT';
						break;
					case Characteristic.RemoteKey.ARROW_RIGHT:
						key = this.config.rightbutton || 'KEYCODE_DPAD_RIGHT';
						break;
					case Characteristic.RemoteKey.SELECT:
						key = this.config.selectbutton || 'KEYCODE_ENTER';
						break;
					case Characteristic.RemoteKey.BACK:
						key = this.config.backbutton || 'KEYCODE_BACK';
						break;
					case Characteristic.RemoteKey.EXIT:
						key = 'KEYCODE_HOME';
						break;
					case Characteristic.RemoteKey.PLAY_PAUSE:
						key = this.config.playpausebutton || 'KEYCODE_MEDIA_PLAY_PAUSE';
						break;
					case Characteristic.RemoteKey.INFORMATION:
						key = this.config.infobutton || 'KEYCODE_INFO';
						break;
				}

				this.adb.sendKeycode(key).then(({ result, message }) => {
					if (!result) throw message;
					this.displayDebug(`Remote Control - Sending: ${key}`);
				}).catch(error => {
					this.displayDebug(`Remote Control - Can't send: ${key}`)
					if (error) this.displayDebug(`Remote error message:\n${error}`);
				});
			});
	}


	// Output text in color
	red(text) { return `\x1B[31m${text}\x1B[0m`; }
	green(text) { return `\x1B[32m${text}\x1B[0m`; }

	/**
	 * A helper parse app id into usable form
	 * @param {string} appId Android app id string
	 */
	parseInput(appId) {
		if (!appId || appId == this.currentAppID || this.input.length <= 0 || appId == this.input[this.inputIndex].id) return;

		let index = false;

		this.currentAppID = appId;
		this.input.forEach((input, i) => {
			if (appId == input.id) index = i;
		});
		if (index !== false) this.inputIndex = index;

		// Other app, extract human readable name from app id
		if (index === false && !this.hideOther) {
			let name = appId.split(".");
			let humanName = "";
			let i = 0;

			// Extract human readable name from app package name
			while (name[i]) {
				name[i] = name[i].charAt(0).toUpperCase() + name[i].slice(1);
				if (i > 0)
					if (name[i] != "Com" && name[i] != "Android")
						if (name[i] == "Vending") humanName += "Play Store";
						else if (name[i] == "Gm") humanName += "GMail";
						else if (name[i].toLowerCase() == "tv") humanName += (" " + "TV");
						else humanName += (" " + name[i]);
				i++;
			}
			humanName = humanName.trim();
			if (humanName != "Other") humanName = `${humanName.trim()}`;

			this.inputIndex = this.input.length - 1;
			if (this.input[this.inputIndex]) this.input[this.inputIndex].id = appId;
			if (this.input[this.inputIndex].service) {
				if (!this.hidenumber) {
					let index = this.inputIndex + 1
					if (index < 10) index = `0${index}`;
					humanName = `${index} ${humanName}`;
				}
				this.input[this.inputIndex].service.updateCharacteristic(Characteristic.ConfiguredName, `${humanName}`);
			}
		}

		// Set the accessory input to current selected app
		this.accessoryService.updateCharacteristic(Characteristic.ActiveIdentifier, this.inputIndex);
		this.displayInfo(`Input - Current app id - \x1b[4m${this.currentAppID}\x1b[0m`);
	}

	/**
	 * A helper to output log, only appeared after with debug config set to true
	 * @param {string} text text to display in Homebridge log
	 */
	displayDebug(...args) {
		args.unshift(`\x1b[2m${this.name} - 🐞`);
		args.push(`\x1b[0m`);
		if (this.debug) this.log.info(...args);
	}

	/**
	 * A helper to output log
	 * @param {string} text text to display in Homebridge log
	 */
	displayInfo(...args) {
		args.unshift(`${this.name} - 🤖`);
		this.log.info(...args);
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
			this.log.info('-------------------------------------------------');
		}
	}

	removeAccessory(platformAccessory) {
		this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
	}
}