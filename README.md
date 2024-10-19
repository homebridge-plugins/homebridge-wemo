<p align="center">
   <a href="https://github.com/homebridge-plugins/homebridge-wemo"><img alt="Homebridge Verified" src="https://user-images.githubusercontent.com/43026681/126868557-d0983348-d124-4247-bea9-7dcc62849cdf.png" width="600px"></a>
</p>
<span align="center">

# homebridge-wemo

Homebridge plugin to integrate Wemo devices into HomeKit

[![npm](https://img.shields.io/npm/v/homebridge-wemo/latest?label=latest)](https://www.npmjs.com/package/homebridge-wemo)
[![npm](https://img.shields.io/npm/v/homebridge-wemo/beta?label=beta)](https://github.com/homebridge-plugins/homebridge-wemo/wiki/Beta-Version)

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![hoobs-certified](https://badgen.net/badge/HOOBS/certified/yellow?label=hoobs)](https://plugins.hoobs.org/plugin/homebridge-wemo)

[![npm](https://img.shields.io/npm/dt/homebridge-wemo)](https://www.npmjs.com/package/homebridge-wemo)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.com/channels/432663330281226270/742733745743855627)

</span>

### Plugin Information

- This plugin allows you to view and control your Wemo devices within HomeKit. The plugin:
  - does not require your Wemo credentials as uses local network discovery (SSDP) and local control
  - will attempt to control your devices via a local HTTP request
  - will attempt to establish a UPnP connection to your devices to listen for external changes (if disabled, HTTP polling is used)

### Prerequisites

- To use this plugin, you will need to already have:
  - [Node](https://nodejs.org): latest version of `v18` or `v20` - any other major version is not supported.
  - [Homebridge](https://homebridge.io): `v1.6` - refer to link for more information and installation instructions.
  - For the UPnP connection, make sure your Homebridge instance has an allocated IP from the same IP network or VLAN as your Wemo devices. Otherwise, you should disable the UPnP connection to avoid connection errors.

### Setup

- [Installation](https://github.com/homebridge-plugins/homebridge-wemo/wiki/Installation)
- [Configuration](https://github.com/homebridge-plugins/homebridge-wemo/wiki/Configuration)
- [Beta Version](https://github.com/homebridge/homebridge/wiki/How-to-Install-Alternate-Plugin-Versions)
- [Node Version](https://github.com/homebridge-plugins/homebridge-wemo/wiki/Node-Version)

### Features

- [Supported Devices](https://github.com/homebridge-plugins/homebridge-wemo/wiki/Supported-Devices)

### Help/About

- [Common Errors](https://github.com/homebridge-plugins/homebridge-wemo/wiki/Common-Errors)
- [Support Request](https://github.com/homebridge-plugins/homebridge-wemo/issues/new/choose)
- [Changelog](https://github.com/homebridge-plugins/homebridge-wemo/blob/latest/CHANGELOG.md)
- [About Me](https://github.com/sponsors/bwp91)

### Credits

- To the creator of this plugin: [@rudders](https://github.com/rudders), and to [@devbobo](https://github.com/devbobo) for his contributions.
- To the creator of [wemo-client](https://github.com/timonreinhard/wemo-client) (which is now contained within this plugin): [@timonreinhard](https://github.com/timonreinhard).
- To [Ben Hardill](http://www.hardill.me.uk/wordpress/tag/wemo/) for his research on Wemo devices.
- To all users who have helped/tested to enable functionality for new devices.
- To the creators/contributors of [Fakegato](https://github.com/simont77/fakegato-history): [@simont77](https://github.com/simont77) and [@NorthernMan54](https://github.com/NorthernMan54).
- To the creator of the awesome plugin header logo: [Keryan Belahcene](https://www.instagram.com/keryan.me).
- To the creators/contributors of [Homebridge](https://homebridge.io) who make this plugin possible.

### Disclaimer

- I am in no way affiliated with Belkin/Wemo and this plugin is a personal project that I maintain in my free time.
- Use this plugin entirely at your own risk - please see licence for more information.
