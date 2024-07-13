# Change Log

All notable changes to homebridge-wemo will be documented in this file.

## BETA

### Changed

- Fixed for `hap-nodejs` v1.0.0
- Updated dependencies
- Bump `node` recommended versions to v18.20.4 or v20.15.1

### Fixed

- Setup issues with Wemo Link devices

### Removed

- Support for node 16

## 6.1.2 (2023-09-18)

⚠️ Note this will be the last version of the plugin to support Node 16.
- Node 16 moves to 'end of life' on 2023-09-11 ([more info](https://nodejs.org/en/blog/announcements/nodejs16-eol))
- This is in-line with the Homebridge guidelines on supporting node versions ([more info](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js/))
- If you are currently using Node 16, now is a good time to upgrade to Node 18 or 20 (see the link above for more info)

### Changed

- Bump `node` supported versions to v16.20.1 or v18.17.1 or v20.7.0

### Fixed

- Properly ignore serial numbers if they aren't already in upper case

## 6.1.1 (2023-08-28)

### Changed

- Updated dependencies

### Fixed

- Show config option `outletInUseTrue` even when `showAs` is not selected

## 6.1.0 (2023-06-17)

### Added

- Configuration option to force enable a Wemo Insight to always show outlet in use to true

### Changed

- Bump `node` supported versions to v16.20.0 or v18.16.0 or v20.1.0
- Updated dependencies

## 6.0.4 (2023-05-01)

### Changed

- README changes
- Dependency updates

## 6.0.3 (2023-04-22)

### Changed

- Update dependencies
- Bump `node` supported versions to v16.20.0 or v18.16.0 or v20.0.0

## 6.0.2 (2023-04-10)

### Changed

- Bump `xml2js` dependency

## 6.0.1 (2023-04-05)

### Changed

- Simplify log welcome messages
- Bump `node` recommended versions to v16.20.0 or v18.15.0

### Fixed

- Eve switch values for light switches

## 6.0.0 (2023-03-11)

### Breaking

- Remove official support for Node 14
- Remove option to disable plugin - this is now available in the Homebridge UI
- Remove option for debug logging - this will be enabled when using a beta version of the plugin
- Remove individual accessory logging options to simplify the config

### Changed

- Bump `homebridge` recommended version to v1.6.0 or v2.0.0-beta
- Bump `node` recommended versions to v16.19.1 or v18.15.0

## 5.0.5 (2022-10-16)

### Changed

- Bump `node` recommended versions to v14.20.1 or v16.18.0 or v18.11.0
- Bump `axios` to v1.1.3

## 5.0.4 (2022-09-25)

### Changed

- Correct parameters for `updatePlatformAccessories()`
- Updated `homebridge` recommended version to v1.5.0
- Bump `node` recommended versions to v14.20.1 or v16.17.1
- Updated dev dependencies

## 5.0.3 (2022-06-08)

### Changed

- Bump `node` recommended versions to v14.19.3 or v16.15.1

### Fixed

- Fix a Crockpot issue when plugin receives off value
- A potential issue showing errors in the logs

## 5.0.2 (2022-05-28)

### Changed

- More fixes and refactoring

## 5.0.1 (2022-05-28)

### Fixed

- An error message when initialising Wemo motion devices

## 5.0.0 (2022-05-28)

### Potentially Breaking Changes

⚠️ The minimum required version of Homebridge is now v1.4.0
⚠️ The minimum required version of Node is now v14

### Changed

- Changed to ESM package
- Bump `ip` to v2.0.0
- Bump `node` recommended versions to v14.19.3 or v16.15.0

## 4.7.3 (2022-04-29)

### Changed

- Bump `axios` to v0.27.2
- Bump `node` recommended versions to v14.19.1 or v16.15.0

### Fixed

- Node 18 `networkInterfaces` fix
  - Note that Homebridge nor this plugin do not _officially_ support Node 18 until October 2022

## 4.7.2 (2022-03-20)

### Changed

- Bump `axios` to v0.26.1
- Bump `node` recommended versions to v14.19.1 or v16.14.2

### Fixed

- Some fixes for Wemo Crockpot
- Accessory name logging on http receive device update failures

## 4.7.1 (2022-02-27)

### Changed

- Bump `axios` to v0.26.0
- Bump `node` recommended versions to v14.19.0 or v16.14.0

## 4.7.0 (2022-02-08)

### Added

- Support for `HumidifierB` model of Wemo Humidifiers

### Fixed

- Characteristic warning for Wemo Humidifier

## 4.6.0 (2022-01-28)

See ⚠️ for potentially breaking changes

### Added

- Support for Wemo Coffee Maker
- Config option to hide device connection errors from the log

### Changed

- ⚠️ Config option added to manually enable colour control for Wemo Link bulbs
  - Some bulbs that don't support colour control seem to report that they incorrectly do
- Bump `axios` to v0.25.0
- Bump `homebridge` recommended version to v1.4.0

### Fixed

- HomeKit 'No Response' issue with Wemo Maker
- Unsupported devices will now only show once in the log when first discovered

## 4.5.4 (2022-01-13)

### Changed

- Bump `node` recommended versions to v14.18.3 or v16.13.2

### Fixed

- Plugin crash for older versions of Homebridge

## 4.5.3 (2022-01-05)

### Changed

- Bump `homebridge` recommended version to v1.3.9

## 4.5.2 (2021-12-30)

### Changed

- Plugin will log HAPNodeJS version on startup
- Default UPnP interval increased to `300` (5 minute interval)

## 4.5.1 (2021-12-22)

### Fixed

- Option to specify the subscription time for UPnP subscriptions, eero users _may_ benefit from increasing this value

## 4.5.0 (2021-12-21)

### Added

- Option to specify the subscription time for UPnP subscriptions, eero users _may_ benefit from increasing this value

### Changed

- Moved commonly used configuration options out of the 'Optional Settings' section for easier access

## 4.4.0 (2021-12-08)

See ⚠️ for breaking changes

### Changed

- Allow a custom name for the Air Purifier since the device name in the Wemo app is not available to the plugin
- Bump `homebridge` recommended version to v1.3.8
- Bump `node` recommended versions to v14.18.2 or v16.13.1

### Fixed

- Fixed a characteristic warning for the Air Purifier

### Removed

- ⚠️ Removed the `manualDevices[]` config entry, the same functionality is available in the device-type specific sections

## 4.3.0 (2021-11-18)

### Added

- Colour support for supported Wemo bulbs
- Filter status information for Wemo Holmes Purifier

### Fixed

- An `undefined` logging entry for the Wemo Insight

## 4.2.6 (2021-10-31)

### Changed

- Increase range of scanned ports from `49151` to `49159`
- Bump `node` recommended versions to v14.18.1 or v16.13.0
- Bump `axios` to v0.24.0

## 4.2.5 (2021-10-20)

### Changed

- Some small changes to Fakegato debug logging

### Fixed

- An Eve app 'no data' gap for garage devices when restarting the plugin

## 4.2.4 (2021-10-16)

### Changed

- Recommended node versions bumped to v14.18.1 or v16.11.1
- Recommended Homebridge bumped to v1.3.5
- Bump `axios` to v0.23.0

### Fixed

- An error when trying to unregister a hidden accessory from Homebridge

## 4.2.3 (2021-10-03)

### Changed

- Bump `axios` to v0.22.0

## 4.2.2 (2021-09-30)

### Fixed

- Increase UPnP subscription time to 130 seconds to fix instances of `412` error

## 4.2.1 (2021-09-30)

### Changed

- Recommended node versions bumped to v14.18.0 or v16.10.0

## 4.2.0 (2021-09-28)

### Added

- `wemoClient.callback_url` configuration option to override the UPnP callback URL

### Changed

- UPnP callback url now uses the accessory UUID (not the UDN) so the plugin immediately knows which accessory a notification relates to

## 4.1.6 (2021-09-09)

### Changed

- `configureAccessory` function simplified to reduce chance of accessory cache retrieval failing
- Bump `axios` to v0.21.4

## 4.1.5 (2021-09-05)

### Changed

- Use `serialNumber` for accessory name if `friendlyName` not present
- Recommended node version bumped to v14.17.6
- Bump `axios` to v0.21.3

## 4.1.4 (2021-08-22)

### Changed

- Ignore `pywemo` virtual device type `urn:Belkin:device:switch:1`

## 4.1.3 (2021-08-18)

### Fixed

- Better handling of NodeSSDP `No sockets available, cannot start.` error

## 4.1.2 (2021-08-17)

### Fixed

- An unhandled rejection error when initialising Wemo Link

## 4.1.1 (2021-08-12)

### Changed

- **Platform Versions**
  - Recommended node version bumped to v14.17.5

### Fixed

- Fixed title of `debugNodeSSDP` setting (only visible in HOOBS)

## 4.1.0 (2021-08-10)

### Added

- **New Mode: `semi`**
  - This mode will attempt to auto discover the devices you have configured in the settings and will ignore any discovered devices that aren't configured. This mode will also initialise manual devices you have configured.
  - In this mode, the plugin will skip the discovery process whilst all devices have been found and haven't reported an error
- **UPnP & HTTP Polling Options**
  - Global option to disable UPnP
    - UPnP offers real-time notifications to the plugin on external changes, but can be problematic if your devices are on a different ip network or VLAN to your Homebridge instance
    - HTTP Polling will be used if UPnP has been disabled
  - Option to override choice of UPnP or HTTP polling per device
  - HTTP polling interval configuration option
- **All Devices**
  - A log warning and a hap error when controlling a device before it has been initially discovered
- **Wemo Links**
  - New configuration section for Wemo Links, with options to manually specify an IP/URL and ignore the device (+ all subdevices)

### Changed

- **UPnP & HTTP Polling**
  - Controlling a device will be attempted regardless of the UPnP connection status if the plugin has cached IP and port info
  - When the UPnP connection fails and reconnects, the plugin will no longer reinitialise the device as new. Instead, the subscriptions will restart with any updated IP and port information.
  - UPnP subscription `setTimeout`s will be cancelled on Homebridge shutdown event
  - Plugin will now properly unsubscribe from UPnP events on Homebridge shutdown event
- **Manual Mode**
  - In `manual` mode, the plugin will skip the discovery process whilst all devices have been found and haven't reported an error
- **Logging**
  - The dreaded `awaiting (re)connection` repeated message has been removed
    - The plugin will continue to repeatedly log any devices that are awaiting initial discovery on plugin startup
    - If an already-discovered device reports a HTTP/UPnP error in due course, the plugin will log the error **once**, and log again when the connection has been re-established
- **Wemo Dimmers**
  - Some newer models of the Wemo Dimmer maybe don't support UPnP?
    - The plugin will no longer automatically HTTP poll newer versions of these dimmer devices
    - To re-enable the polling, set up an entry for your device in the configuration and change the 'Listener Type' to 'HTTP'
- **Wemo Crockpot**
  - The polling interval will now adhere to the global 'Polling Interval' setting (rather than hard-coded 30 seconds)
- **Backend**
  - Discovery increment count now resets from 3 to 0 to avoid manipulating large numbers over time
  - Reduced UPnP subscription time from 150 to 120 seconds
  - Some code refactoring

### Fixed

- **Wemo Dimmers**
  - When turning on, the plugin requests an updated brightness value, which if fails, will no longer affect the outcome of the original switch-on request

### Deprecated

- Manual devices configuration section
  - Please start to move any entries you have from the manual devices section to the appropriate device section
  - Any entries in the manual devices section will continue to work (ie this is not a breaking change)

## 4.0.0 (2021-07-29)

### Added

- **Configuration**
  - Plugin will now check for duplicate device ID entries in the config and ignore them

### Changed

- ⚠️ **Platform Versions**
  - Recommended node version bumped to v14.17.4
  - Recommended homebridge version bumped to v1.3.4

### Removed

- ⚠️ `ignoredDevices[]` configuration entry
  - Devices can be ignored by entering a serial number in the relevant device section and ticking 'Hide From HomeKit'
  - It is recommended to set up your ignored devices **before** updating to avoid losing your list of serial numbers

## 3.4.2 (2021-07-27)

### Fixed

- An issue preventing Wemo Outlets being exposed as `Switch` or `AirPurifier` types

## 3.4.1 (2021-07-24)

### Fixed

- Use new plugin alias in config schema file

## 3.4.0 (2021-07-24)

### Changed

- Plugin name from `homebridge-platform-wemo` to `homebridge-wemo`
- Plugin alias from `BelkinWeMo` to `Wemo`

## 3.3.0 (2021-07-22)

### Added

- **Plugin UI**
  - A device can now be ignored/removed from Homebridge by the `ignoreDevice` setting in the device configuration sections
  - Set a manual IP/URL for a device with the `manualIP` setting in the device configuration sections
- **Wemo Makers**
  - Option to reverse the polarity of open and closed states of the sensor when exposed as a `Switch+ContactSensor`

### Changed

- **Plugin UI**
  - `label` field now appears first in the device configuration sections
  - 'Network Settings' moved inside 'Optional Settings'

### Fixed

- Logging status for the Wemo Maker sensor (when exposed as a Switch) was incorrectly reversed

## 3.2.2 (2021-07-08)

### Changes

- Revert node version bump to v14.17.3 (back to v14.17.2)

## 3.2.1 (2021-07-07)

### Fixed

- An issue initialising Wemo light switch devices ([#262](https://github.com/bwp91/homebridge-wemo/issues/262))

## 3.2.0 (2021-07-07)

### Added

- **Accessory Logging**
  - `overrideLogging` setting per device type (to replace the removed `overrideDisabledLogging`), which can be set to (and will override the global device logging and debug logging settings):
    - `"default"` to follow the global device update and debug logging setting for this accessory (default if setting not set)
    - `"standard"` to enable device update logging but disable debug logging for this accessory
    - `"debug"` to enable device update and debug logging for this accessory
    - `"disable"` to disable device update and debug logging for this accessory
- **Wemo Outlets & Insights**
  - More consistent settings to expose these devices as an _Outlet_ (default), _Switch_ or _AirPurifier_ accessory types
- **Wemo Bulbs**
  - Transition time config option for brightness and colour temperature changes for Wemo Bulbs (via Link)
  - Remove Adaptive Lighting feature from a device by setting the `adaptiveLightingShift` to `-1`
- **Node-SSDP**
  - Added option to enable node-ssdp library debugging

### Changed

- **Homebridge UI**
  - More interactive Homebridge UI - device configuration will expand once device ID entered
- **Wemo Crockpot**
  - Changed the cooking-time-remaining format in logs to HH:MM
- **Other**
  - Small changes to the startup logging
  - Recommended node version bump to v14.17.3

### Fixed

- A `device.serviceList.service.forEach is not a function` log warning

### Removed

- `ContactSensorState` and other unused characteristics removed from Wemo Maker's `GarageDoorOpener` service
- `OutletInUse` characteristic from Wemo Outlet (not Insight) as this value is always the same as the actual state
- `overrideDisabledLogging` setting for each accessory type (replaced with `overrideLogging` setting)
- `showAsSwitch` setting for Wemo Outlets (replaced with `showAs` setting)

## 3.1.0 (2021-05-26)

### Added

- Expose a Wemo Outlet as a _AirPurifier_ accessory type [[#257](https://github.com/bwp91/homebridge-wemo/issues/257)]

### Changed

- Use `standard-prettier` code formatting
- Recommended node version bump to v14.17.0

## 3.0.9 (2021-05-10)

### Changed

- Reduce 'No Response' timeout to 2 seconds
- Update the correct corresponding characteristic after the 'No Response' timeout
- Ensure user is using at least Homebridge v1.3.0

## 3.0.8 (2021-05-04)

### Changed

- Update config schema title and description for 'Manual Devices'
- Accessory 'identify' function will now add an entry to the log
- Backend refactoring, function and variable name changes

## 3.0.7 (2021-04-27)

### Changed

- Display Wemo Insight 'on time' as HH:MM:SS in logs
- More consistent logging on device errors, and helpful info for common errors

## 3.0.6 (2021-04-24)

### Fixed

- Fix 'time on' and 'total consumption' calculations for Wemo Insights

## 3.0.5 (2021-04-16)

### Changed

- Update wiki links in the Homebridge plugin-ui

### Fixed

- Fix characteristic NaN warning for `LastActivation`

## 3.0.4 (2021-04-14)

### Fixed

- Ensure 'No Response' is removed from Wemo Makers when discovered

## 3.0.3 (2021-04-14)

### Fixed

- Fixes a characteristic issue with Wemo Maker devices

## 3.0.2 (2021-04-13)

### Fixed

- Fix for `Cannot read property 'updateCharacteristic' of undefined` on plugin startup

## 3.0.1 (2021-04-13)

### Requirements

- **Homebridge Users**
  - This plugin has a minimum requirement of Homebridge v1.3.3
- **HOOBS Users**
  - This plugin has a minimum requirement of HOOBS v3.3.4

### Added

- For auto-discovered devices and devices manually-defined with a full address for which the given port does not work, the port scanner will now check to see if a different port is working and setup the device using this new port
- On Homebridge restart, devices will show as 'No Response' until discovered
- 'No Response' messages for devices if controlled and unsuccessful (and this status will be reverted after 5 seconds)
- Debug log messages showing data sent to devices when controlled

### Changed

- Use the new `.onGet`/`.onSet` methods available in Homebridge v1.3
- Logs will show IP and port on device initiation instead of mac address
- Updated plugin-ui 'Support' page links to match GitHub readme file
- Updated README to reflect minimum supported Homebridge/HOOBS and Node versions
- Updated recommended Node to v14.16.1

## 2.15.2 (2021-03-21)

### Changed

- More welcome messages
- Updated `plugin-ui-utils` dependency

### Fixed

- Correct `debugFakegato` setting to type boolean

## 2.15.1 (2021-03-17)

### Changed

- Modified config schema to show titles/descriptions for non Homebridge UI users

## 2.15.0 (2021-03-14)

### Added

- Device's current state will be requested immediately when initialised into Homebridge
- Optional polling setting for newer **Wemo Dimmers** that don't automatically notify the plugin when the brightness is changed externally
- Optional 'timeout' setting for **Wemo Insight** to configure a minimum time between wattage log entries

### Changed

- Open/close time setting for **Wemo Makers** will be hidden if device is set to expose as switch
- **Wemo Makers** no longer need 'dummy' contact sensor to view Eve history
  - For this reason, the `exposeContactSensor` setting is now redundant and so has been removed
- Adaptive Lighting now requires Homebridge 1.3 release
- **Wemo Crockpot** polling interval will be stopped if Homebridge shuts down

## 2.14.0 (2021-03-02)

### Added

- A `label` setting per device group which has no effect except to help identify the device when editing the configuration
- [experimental] Expose a Contact Sensor service for your Wemo Maker (via the plugin settings, when configured as a Garage Door) to show more information in the Eve app, including:
  - when the door was last open
  - how many times it's been opened
  - for how long the garage door was open each time

### Changed

- Plugin will now check if a device is ignored by the device USN at an earlier stage of being discovered
- Updated minimum Node to v14.16.0

## 2.13.0 (2021-02-17)

### Added

- **Configuration**
  - Explicitly enable device logging _per_ device if you have `disableDeviceLogging` set to `true`
  - `brightnessStep` option to specify a brightness step in the Home app per Wemo Dimmer/Bulb
  - `adaptiveLightingShift` option to offset the Adaptive Lighting values per Wemo Bulb
- Plugin-UI shows an status icon next to the reachability + shows device firmware
- In debug mode, the plugin will log each device's customised options when initialised

### Changed

- Raised minimum Homebridge beta required for Adaptive Lighting to 1.3.0-beta.58
- Disable Adaptive Lighting if the plugin detects a significant colour change (i.e. controlled externally)

### Fixed

- Fixes a uuid error when adding Insights to Homebridge

## 2.12.0 (2021-02-13)

### Added

- A queue for device loading to improve reliability for users with a lot of Wemo devices
- Configuration checks to highlight any unnecessary or incorrectly formatted settings you have
- Network Settings section to the Homebridge UI where you can configure the settings that were the `wemoClient` settings
- Links to 'Configuration' and 'Uninstall' wiki pages in the plugin-ui

### Changed

- ⚠️ `disableDiscovery`, `noMotionTimer`, `doorOpenTimer` and `outletAsSwitch` settings no longer have any effect
- Adapted port scanning method which now checks the reachability of the `setup.xml` file
- Hide unused modes for `HeaterCooler` services for Wemo Heater, Dehumidifier, Purifier and Crockpot
- Error messages refactored to show the most useful information
- Updated minimum Homebridge to v1.1.7
- Updated minimum Node to v14.15.5
- Fakegato library formatting and simplification
- [Backend] Code refactoring

## 2.11.0 (2021-02-01)

### Changed

- **Configuration Changes**
  - These changes are backwards compatible with existing setups
  - New 'Wemo Outlets' section to define outlets to show as switches
  - Removal of `removeByName` from the UI, this setting is still available manually
  - Deprecation of the following settings:
    - `disableDiscovery` - now has no effect
    - `doorOpenTimer` - now configured per Wemo Maker device in the 'Wemo Makers' section
    - `noMotionTimer` - now configured per Wemo Motion device in the 'Wemo Motions' section
    - `outletAsSwitch` - now configured per Wemo Outlet device in the 'Wemo Outlets' section
  - These deprecated settings have their own section in the plugin UI
- Clean up the plugin-ui by removing unnecessary descriptions

### Fixed

- Properly catch exceptions on SSDP search errors
- Fixes a bug when initialising Garage Doors

## 2.10.0 (2021-01-30)

### Added

- New configuration option `mode` to choose between:
  - `mode: "auto"` the plugin will auto-discover devices **and** configure manual devices (default if option not set)
  - `mode: "manual"` the plugin will **only** configure manual devices
- Support for the Wemo Outdoor Plug
- [Experimental] Automatic port scan for manual devices
  - Use a full address `http://192.168.1.X:49153/setup.xml` as before to fully configure a manual device
  - Use an IP `192.168.1.X` to let the plugin scan between ports 49152 - 49155 and choose the correct port
- Set a custom `noMotionTimer` per Wemo motion device (NetCam/Motion Sensor)
  - If this is not configured then the plugin will continue to use the global `noMotionTimer` setting per motion device
  - If the global setting is not configured then the plugin will use the default of 60 seconds
- Cumulative `TotalConsumption` for Insight devices
  - This changes the current method of resetting each day
  - This can be reverted back to resetting each day in the plugin settings with the `showTodayTC` config option
- Set a custom `wattDiff` (wattage difference) for Insight devices - the plugin will not log consecutive wattage updates if the difference from the previous is less than this value (default: `0`)

### Changed

- `discoveryInterval` now needs a minimum value of `15` and discovery cannot be disabled
  - Existing configurations with lower value will be disregarded and `15` will be used
  - The option of disabling the discovery interval has been removed as this interval is essential for correcting connection issues for all your Wemo devices
- Logging for manual devices that cause errors when loading (e.g. IP/port change)
- More consistent and clearer error logging
- Updated plugin-ui-utils dep and use new method to get cached accessories

### Fixed

- Fixes an issue where the Insight would consistently log outlet-in-use between true and false

## 2.9.1 (2021-01-21)

### Changed

- Minimum Homebridge beta needed for Adaptive Lighting bumped to beta-46
- Fakegato logging disabled in Homebridge `debug` mode, can be explicitly enabled with `debugFakegato`
- Unsupported device types to show urn in logs

### Fixed

- Fixes a 'multiple callback' issue with Fakegato history service

## 2.9.0 (2021-01-14)

### Added

- New configuration option `removeByName` to remove 'orphan' accessories from the cache
- (Backend) Gracefully close listener server and ssdp client on Homebridge shutdown
- Created CHANGELOG.md

### Changed

- Modifications to the layout of the plugin settings screen
- Removal of maximum value for `number` types on plugin settings screen
- Remove `renewing subscription` log entries which appeared repetitively in plugin `debug` mode
- `subscription error` log entries will now always appear, not just when in plugin `debug` mode
- Changes to startup log messages
- Backend code changes
