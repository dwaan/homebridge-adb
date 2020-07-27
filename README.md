# Homebridge ADB

A simple homebridge script to control Android device with ADB enable

## Configuration

Here an example of configuration that you can use.

	{
	    "platform": "HomebridgeADB",
	    "devices": [
	        {
	            "name": "NVIDIA Shield",
	            "interval": 1000,
	            "ip": "192.168.1.106"
	        },
	        {
	            "name": "Meizu",
	            "interval": 1000,
	            "ip": "192.168.1.121"
	        }
	    ]
	}
	
* platform (mandatory): the name of this plugin.
* name (mandatory): the name of the device.
* ip (mandatory): the IP address of the device.
* interval (optional): if not set, the plugin will check device statuses every 5000 miliseconds.

## ADB command that this script use

* Device name `adb -s 192.168.1.106 shell "getprop ro.product.manufacturer"`
* Device model `adb -s 192.168.1.106 shell "getprop ro.product.model"`
* Device serial number 
`adb -s 192.168.1.106 shell "getprop ro.serialno"`
