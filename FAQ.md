## FAQ

* My accessory power status is turning ON and OFF repeatedly in Home app
    * Choose higher ADB timeout. But the higher the value, the less responsive the plugins will be. Find the best number suitable for your need.
* My playback sensor doesn't seem to working after updating to 1.4.3 from 1.4.x
	* Remove your playback sensor and the re-add it again in Home app, it seems like the new code causing Homekit to unrecognized it.
* My accessory is not responding after updating to 1.4.*
	* Since adding new features of playback sensor, HomeKit is unable to recognize old accessory due to different characteristics. To fix this, you need to remove your accesory from Home app, then rename you accessory in config.json, and restart Homebridhe. This will create a new accesories that you can re-add again in home app. When you add them, be sure to rename your new accessory the same as to the old one in Home app if posible, this hopefully will retain your automations.
* Where can I use volume and D-Pad control for my accessory?
	* First turn on "Apple TV Remote" control from your iOS accessory inside Settings -> Control Center. Then swipe down Control Center, you'll see a remote icon. Tap the remote icon to open the remote, you can use your iOS accessory screen for the D-Pad, and use your iOS accessory physical volume button to control your accessory volume.
* Why I can't turn on my accessory after turning it off?
	* Your accessory might disconnected from network connection after you turn off your accessory. Please make sure your accessory still able to recieve network connection when it turned off. If your accessory support Wake On LAN, please active it in the plugin by entering it's mac address. Alternatively you can install some app that prevent your accessory disconnected from network.
* Is this safe?
	* Actually I don't know, it feels very dirty (I need to wash my hand everytime I use this) and hacky, but it works for me.
* I found some bugs, what should I do?
	* You can submit your bugs here [https://github.com/dwaan/homebridge-adb/issues](https://github.com/dwaan/homebridge-adb/issues) or you can help me to fix it by sending pull request.
* Can this plugins do (insert stuff you want to do to your accessory)?
	* I think so, ADB can basically control your accessory remotely. If you have other idea for what this can do, you can submit your idea as an issue.


## **GOOD TO KNOW**: ADB commands that this plugin use

* Accessory name
	```
	adb -s your-accessory-ip shell "getprop ro.product.manufacturer"
	```
* Accessory model
	```
	adb -s your-accessory-ip shell "getprop ro.product.model"
	```
* Accessory serial number
	```
	adb -s your-accessory-ip "getprop ro.serialno"
	```
* To run "keyboard" command like up, down, sleep, awake, volume control, etc
	```
	adb -s your-accessory-ip shell "input keyevent KEYCODE"
	```
* To know accessory sleep status based on whether secreen is turned on or off
	```
	adb -s your-accessory-ip shell 'dumpsys power | grep mHoldingDisplay | cut -d = -f 2'
	```
* Running an app using their package name
	```
	adb -s your-accessory-ip shell "monkey -p package.name 1"
	```
* To know current on screen app

	New:
	```
	adb -s your-accessory-ip shell "dumpsys activity activities | grep ' ResumedActivity'"
	```
	Old:
	```
	adb -s your-accessory-ip shell "dumpsys window windows | grep -E mFocusedApp"
	```