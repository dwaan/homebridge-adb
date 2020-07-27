# Homebridge ADB

A simple homebridge script to control Android device with ADB enable

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
                        },
                        {
                            "name": "VPN Unlimited",
                            "id": "com.simplexsolutionsinc.vpn_unlimited"
                        }
                    ]
                },
                {
                    "name": "Meizu",
                    "interval": 1000,
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

* platform (mandatory): the name of this plugin.
* name (mandatory): the name of the device.
* ip (mandatory): the IP address of the device.
* interval (optional): if not set, the plugin will check device statuses every 5000 miliseconds.
* inputs (optional): by default the plugins will create Home for launcher shortcut and Other for previous App shortcut as input. If set, the plugins will add more input based on the config.

## ADB command that this script use

* Device name `adb -s 192.168.1.106 shell "getprop ro.product.manufacturer"`
* Device model `adb -s 192.168.1.106 shell "getprop ro.product.model"`
* Device serial number
`adb -s 192.168.1.106 shell "getprop ro.serialno"`
