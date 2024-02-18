[![npm-version](https://badgen.net/npm/v/homebridge-adb)](https://www.npmjs.com/package/homebridge-adb)
[![npm-total-downloads](https://badgen.net/npm/dt/homebridge-adb)](https://www.npmjs.com/package/homebridge-adb)
[![Donate](https://badgen.net/badge/buymeacoffee/donate?icon=https://ico.now.sh/buymeacoffee/fff)](https://www.buymeacoffee.com/dwaan)

<p align="center">
<img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" width="150">
</p>

# Homebridge ADB and Shell Scripts

A HomeBridge plugin to control remote ADB enabled Android device. The idea is to make random Android based TV box can be controlled with Home App. It make any Android device appear as TV accesory. Where you can control on/off status, volume and dpad control via Control Center remote, and launch certain predefined app defined in the configuration.

This plugins register it self as external accesorries. Make sure after adding Homebridge bridge in Home App, manually "add accesories" to add the android device in the Home App.

|![](img/IMG_7775.jpg)|![](img/IMG_7776.jpg)|![](img/IMG_7777.jpg)|![](img/IMG_7778.jpg)|
|----------|----------|----------|----------|

## Prerequisite

1. **Install Homebridge**, Homebridge Config UI X (this plugin support web configuration over there), and this plugins
	```
	sudo npm install -g --unsafe-perm homebridge homebridge-config-ui-x
	sudo npm install homebridge-adb
	```

2. **Install ADB tools inside Homebridge server**. Open Homebridge Config UI X in your browser then navigate to terminal or ssh to your homebridge server, and then run this command:
	* If the homebridge server run inside Ubuntu, use this command:
		```
		sudo apt-get install android-tools-adb android-tools-fastboot
		```
	*  Or, if the homebridge run inside Docker container like the one from oznu/docker-homebridge, please refer to **Docker container** section
	*  Or, if you're using other OS, please refer this link to download the ADB tools: [https://developer.android.com/studio/releases/platform-tools](https://developer.android.com/studio/releases/platform-tools)
	*  Check if the ADB installed properly by running this command:
		```
		adb --version
		```
		This will output something like `Android Debug Bridge version x.x.x`

3. **Enable remote developer mode in your Android device**. Visit this documentation for more information [https://developer.android.com/studio/debug/dev-options](https://developer.android.com/studio/debug/dev-options)

4. **IMPORTANT**: Some Android device doesn't support "Remote ADB" by default. If your device is one of them, connect your device with USB cable to any computer with ADB installed. Open terminal and run this command:
	```
	adb tcpip 5555
	```
	if no error produced, disconnect unplug the USB cable from the computer.

5. _OPTIONAL_ Run this command to make sure you can connect to device:
	```
	adb connect your-device-ip
	```
	If all goes well, there will be a popup window in your android device asking for debug permission. After you accept the request, you might want to do kill the adb server to make a fresh connection
	```
	adb kill-server
	```
	After that reconnect your device again with previous adb connect. Test your adb connection by running this command:
	```
	adb -s your-device-ip shell "getprop ro.product.model"
	```
	This command will output your device model.

### **Docker container** based on [oznu/docker-homebridge](https://github.com/oznu/docker-homebridge)

*  **MANDATORY** If you're using a container based on Alpine Linux (like `oznu/docker-homebridge:latest`), run this command in terminal to install adb
	```shell
	# Install adb, required by the homebridge-adb plugin
	echo 'http://dl-cdn.alpinelinux.org/alpine/v3.14/main/' >> /etc/apk/repositories
	echo 'http://dl-cdn.alpinelinux.org/alpine/v3.14/community/' >> /etc/apk/repositories
	apk add android-tools
	```
	You can use other version of repo, but I only tested the v3.14 repo, and it seems it's the only adb tools that work with oznu/docker-homebridge .

* **MANDATORY** If you're using a container based on Debian (like the `oznu/docker-homebridge:ubuntu` & `oznu/docker-homebridge:debian` docker image), run this command in terminal to install adb
	```shell
	# Update apt package index
	apt-get update

	# Install adb, required by the homebridge-adb plugin
	apt-get install -y android-tools-adb android-tools-fastboot
	```

*  _OPTIONAL_ Append the followings line to your `config/startup.sh` to install or update this plugin on every container restart:
	```shell
	# Install the homebridge-adb plugin
	npm install homebridge-adb
	```

* _OPTIONAL_ If you run into issues when connecting your android device (sometimes adb can't create the `$HOME/.android/adbkey`), add this line to your `config/startup.sh`:
	```shell
	# Fix connection issues for the homebridge-adb plugin
	adb connect YOUR_ANDROID_DEVICE_IP
	```



## Configuration

Here an example of configuration that you can use.
```json
"platforms": [
	{
		"platform": "HomebridgeADB",
		"accessories": [
			{
				"name": "NVIDIA Shield",
				"interval": 1000,
				"ip": "192.168.1.1",
				"path": "/usr/bin/adb",
				"timeout": 1000,
				"playbacksensor": true,
				"playpauseobutton": "KEYCODE_MEDIA_PLAY_PAUSE",
				"backbutton": "shell sh ./myscript.sh",
				"infobutton": "KEYCODE_HOME KEYCODE_HOME",
				"category": "TV_STREAMING_STICK",
				"hidenumber": true,
				"hidehome": true,
				"hideother": true,
				"debug": true,
				"skipSpeaker": false,
				"inputs": [
					{
						"name": "HBO Max",
						"id": "com.hbo.hbonow"
					},
					{
						"name": "Apple Music",
						"id": "com.apple.android.music"
					}
				]
			},
			{
				"name": "Meizu",
				"ip": "192.168.1.2",
				"playbacksensor": false,
				"mac": "97:b6:e8:46:9f:cb",
				"inputs": [
					{
						"name": "Termux",
						"id": "com.termux",
						"adb": "monkey -p com.termux 1"
					}
				]
			}
		]
	}
]
```

* **platform** (mandatory): the name of this plugin.
* **accessories** (mandatory): JSON object of your devices.
	* **name** (mandatory): the name of the accessory.
	* **ip** (mandatory): the IP address of the accessory.
	* *mac* (optional): the MAC address of the accessory. When provided and your accessory support Wake On LAN, this plugin will try to use Wake On LAN to Turn On your accessory. Useful if your accessory disconnect ADB connection after it turned off.
	* *path* (optional): if you prefer using direct path to access ADB instead of setting up in your global path, you can type the path here including the executable filename.
	* *interval* (optional): if not set, the plugin will check accessory statuses every 1000 miliseconds. The minimum interval value is 500. Lower then that, the plugin will flood your network.
	* *timeout* (optional): if not set, the plugin will limit ADB execution timeout to 3000 miliseconds. The minimum timeout value is 1000. Smaller value can make plugins more responsive but will prone to time out especially when your network is slow.
	* *inputs* (optional): by default the plugins will create Home for launcher shortcut and Other for previous app shortcut as input. If set, the plugins will add more input based on the config. To know your app id, please see your Homebridge log. When you leave this blank, and set *hidehhome* and *hideother* to true, the plugins will hide inputs in Home App.
		* *name* (mandatory): the name of the input.
		* *id* (mandatory): the application id. The id will be use for input switcher in Home app. If you put random id, the input will move to "other".
		* *adb* (optional): you can run your own ADB shell command here, such as: `monkey -p com.app.id 1`. This is an ADB shell command, so you doesn't need to type "adb -s ipaddress shell ...".
	* *playbacksensor* (optional): if set to *true*, plugin will create a motion sensor based on playback activity (either video or music).
	* *category* (optional): you can choose from this categories: *APPLE_TV, TELEVISION, TV_STREAMING_STICK, TV_SET_TOP_BOX, AUDIO_RECEIVER, or SPEAKER*. Home app will display different icon based on the category you choose.
	* *volumeup*, *volumedown*, *upbutton*, *leftbutton*, *rightbutton*, *leftbutton*, *infobutton*, *playpauseobutton*, *backbutton*, *poweron*, *poweroff* (optional): assign custom ADB keycode for Remote control action in iOS Control Center.
		* You can put one or more keycodes by seperating them with space, eg: `volumeup: "KEYCODE_VOLUME_UP KEYCODE_VOLUME_DOWN"`. See [https://developer.android.com/reference/android/view/KeyEvent](https://developer.android.com/reference/android/view/KeyEvent) for the keycode list. Or,
		* You can put a ADB shell script to run a shell script inside your device, eg: `leftbutton: "monkey -p com.termux 1"`. Or,
		* You can also put a shell script. Put `shell` identifier to let the plugins know it's a shell script, eg: `volumeup: "shell sh ./myscript.sh"`.
		* You can also put app id to run app, because why not?, eg: `infobutton: "com.google.android.youtube.tv"`.
	* *hidenumber* (optional): if set to *true*, plugin will hide number inputs in Home App.
	* *hidehome* (optional): if set to *true*, plugin will hide "Home" input in Home App.
	* *hideother* (optional): if set to *true*, plugin will hide "Other" input in Home App.
	* *debug* (optional): if set to *true*, plugin will output more debug info in homebridge log.
	* *skipSpeaker* (optional): if set to *true*, an accompanying speaker will not be initialized for the device and will disable volume control in Control Center Remote.

If you're using Homebridge Config UI X, you can configure your device there, but there's a small hiccup with Inputs. It only display one input, but if you press add, it will display the rest of the inputs.

## Questions and Support

If your have any question, refer to [FAQ.md](FAQ.md) first before sending GitHub issues.

If want to support this plugin, [you can buy me an Ice cream by follow this link](https://www.buymeacoffee.com/dwaan). Or feel free to share and stared this repo.

## Sidenote

There is currently an **Android TV** homebridge plugins that work with *"Android TV remote control protocol version 2"*, it should have simpler setup. You can check [the plugin here](https://www.npmjs.com/package/homebridge-androidtv) and see if it's work with your device. __However, it will only work with Android TV devices, not every Android devices__. Note: I'm not the contributor of the that plugin.
