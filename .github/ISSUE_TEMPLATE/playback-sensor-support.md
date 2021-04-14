---
name: Playback Sensor Support
about: Playback Sensor Support for Your Device
title: ''
labels: ''
assignees: ''

---

**Prerequisite**

1. Turn on your device.
2. Open any streaming or media app that you want.
3. Play any video.
4. Open ssh to your Homebridge server or open Terminal in Homebridge Config UI X.
5. Run this command: `adb -s DEVICE_IP_ADDRESS shell "dumpsys media_session"` copy paste the output to a text file called media_session.txt
6. Run this command: `adb -s DEVICE_IP_ADDRESS shell "dumpsys audio"` copy paste the output to a text file called audio.txt
7. Note: in my experience most of apps will appear in `dumpsys media_session` which is the preferable way to detect, but some apps (like Disney+, Cartoon Network) will appear in `dumpsys audio`

**Your Device**
Your Device Name

**App Name**
The app name

**Attachment**
Please attach media_session.txt and audio.txt
