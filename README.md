# Homebridge ADB

A simple homebridge script to control remote ADB enabled Android device. The idea is to have a make random Android based TV box can be controlled with Home App. It make your Android device appear as TV accesory, where you can control sleep status, volume and dpad control via remote, and launch certain predefined app defined by you.

This plugins register it self as external accesorries, so make sure after you add your Homebridge bridge to your Home App, manually add accesories to add the device you want to control via Home App

|![](img/IMG_7295.jpg)|![](img/IMG_7296.jpg)|![](img/IMG_7297.jpg)|![](img/IMG_7298.jpg)|
|----------|----------|----------|----------|

## Prerequisite

* Install Homebridge (and Homebridge UI X if you want) and this plugins
`sudo npm install -g --unsafe-perm homebridge homebridge-adb`

* Make sure you install ADB at the same machine as your Homebridge. 
	*  If you're using Ubuntu, use this command:
	`sudo apt-get install android-tools-adb android-tools-fastboot`
	*  If you're using Alpine Linux (Homebridge Docker image use this), use this command:
	`RUN apk --update-cache --repository http://dl-3.alpinelinux.org/alpine/edge/testing/ add android-tools`
	*  For other OS and method please download it in here: [https://developer.android.com/studio/releases/platform-tools](https://developer.android.com/studio/releases/platform-tools)
	*  When it properly installed, please check your ADB is up and running with this command: 	`adb version`
	
* Enable Developer mode in your Android device, visit this documentation to read more  [https://developer.android.com/studio/debug/dev-options](https://developer.android.com/studio/debug/dev-options)

* Some Android device have remote debug by default. If your device is not one of them, connect your device to your server (or any computer with ADB installed) and run: `adb tcpip 5555` after that just disconnect your device from your computer.

* Run this command to make sure you can connect to device: `adb connect your-device-ip`. If all goes well, there will be a popup window in your android device asking for debug permission. After you accept the request, you might want to do `adb kill-server` and reconnect your device again. After that, you should able to run this command `adb -s your-device-ip shell "getprop ro.product.model"` and get  your device model as the output.



## Configuration

Here an example of configuration that you can use.

    "platforms": [
        {
            "platform": "HomebridgeADB",
            "accessories": [
                {
                    "name": "NVIDIA Shield",
                    "interval": 1000,
                    "ip": "192.168.1.106",
                    "inputs": [
                        {
                            "name": "HBO Now",
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
                    "ip": "192.168.1.121",
                    "inputs": [
                        {
                            "name": "Termux",
                            "id": "com.termux"
                        },
                        {
                            "name": "Apple Music",
                            "id": "com.apple.android.music"
                        }
                    ]
                }
            ]
        }
    ]

* **platform** (mandatory): the name of this plugin.
* **name** (mandatory): the name of the device.
* **ip** (mandatory): the IP address of the device.
* *interval* (optional): if not set, the plugin will check device statuses every 5000 miliseconds.
* *inputs* (optional): by default the plugins will create Home for launcher shortcut and Other for previous App shortcut as input. If set, the plugins will add more input based on the config. To know your app id, please see your Homebridge log.


## ADB command that this script use

* Device name `adb -s your-device-ip shell "getprop ro.product.manufacturer"`
* Device model  `adb -s your-device-ip shell "getprop ro.product.model"`
* Device serial number `adb -s your-device-ip "getprop ro.serialno"`
* To run "keyboard" command like up, down, sleep, awake, volume control, etc `adb -s your-device-ip shell "input keyevent KEYCODE"`
* To know device sleep status based on whether secreen is turned on or off `adb shell 'dumpsys power | grep mHoldingDisplay | cut -d = -f 2'`
* Running an app using their package name `adb -s your-device-ip shell "monkey -p package.name 1`
* To know current on screen app `adb -s your-device-ip shell "dumpsys window windows | grep -E mFocusedApp"`


## FAQ

* Is this safe?
	* Actually I don't know, it feels very dirty (I need to wash my hand everytime I use this) and hacky, but it works for me.
* I found some bugs, what should I do?
	* You can submit your bugs here [https://github.com/dwaan/homebridge-adb/issues](https://github.com/dwaan/homebridge-adb/issues) or you can help me to fix it by sending pull request.
* Can this plugins do (insert stuff you want to do) to my device?
	* I think so, ADB can basically control your device remotely. If you have other idea for what this can do, you can submit your idea as an issue.
* Can I buy you a beer?
	* No, I don't drink alcohol. But if you like this plugins feel free to stared this repo.