# Homebridge ADB

A simple homebridge plugin to control ADB enabled Android devices

## ADB command that this plugins use

* Device name `adb -s 192.168.1.106 shell "getprop ro.product.manufacturer"`
* Device model `adb -s 192.168.1.106 shell "getprop ro.product.model"`
* Device serial number
`adb -s 192.168.1.106 shell "getprop ro.serialno"`
