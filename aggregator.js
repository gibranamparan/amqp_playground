const typeMaps = new Map();
// Key: hardware type, Value: config type
typeMaps.set("Assist", ["beacon"]);
typeMaps.set("Push", ["pull-station", "push-station"]);
typeMaps.set("Touch", ["pendant"]);
typeMaps.set("Move", ["motion"]);
typeMaps.set("Spot", [
  "door",
  "window",
  "universal-transmitter",
  "bed-pad",
  "chair-pad",
  "floor-pad",
  "incontinence-pad",
  "bombardier-cord",
  "smoke-detector",
]);

export function calculateEndDeviceMetrics(
  configLocations,
  configDevices,
  events
) {
  // Get a set of all end devices MAC addresses
  const devicesMacSet = new Set();
  events
    .filter((i) => i.payloadType === "device-event")
    .forEach((item) => {
      devicesMacSet.add(item.payload.senderMac);
    });

  const extenderVisibilityStats = getExtendersVisibilityStats(events);
  console.log("Extender Visibility Stats", extenderVisibilityStats);
  // Prepare the report results
  const results = Array.from(devicesMacSet).map((mac) => {
    const locInfo = locationInfo(mac, configLocations);
    const configDevice = configDevices.find((device) => device.mac === mac);
    const configDeviceType = configDevice?.flavor;

    const latestEndDeviceEvent = getLatestDeviceEvent(mac, events);
    const latestEndDeviceInfo = getLatestEndDeviceInfo(mac, events);
    const latestBatteryVoltage = getLatestBatteryVoltage(mac, events);
    const extenderVisibilityStatsByMac = extenderVisibilityStats.find(
      (i) => i.mac === mac
    );

    const latestDeviceType = latestEndDeviceEvent?.deviceType ?? null;
    const firmwareVersion = latestEndDeviceInfo
      ? `v${latestEndDeviceInfo.majorVersion}.${latestEndDeviceInfo.minorVersion}`
      : null;

    const mostRecentEndDeviceFirmwareVersion =
      getMostRecentEndDeviceFirmwareVersion(events);

    return {
      mac,
      isInConfig: !!configDevice,
      building: locInfo?.building ?? null,
      sectionOrWing: locInfo?.sectionOrWing ?? null,
      floor: locInfo?.floor ?? null,
      location: locInfo?.whereIsInstalled ?? null,
      deviceName: configDevice?.name,
      transmitterProfile: configDevice?.transmitterProfile?.name,
      deviceType: configDeviceType,
      hardwareType: latestDeviceType,
      isMatchingTypes: isConfigTypeMatching(configDeviceType, latestDeviceType),
      firmwareVersion,
      isFirmwareUpToDate:
        firmwareVersion === mostRecentEndDeviceFirmwareVersion,
      batteryVoltage: latestBatteryVoltage[0]?.Value, // No data available
      minExtenders: extenderVisibilityStatsByMac?.min ?? null,
      medianExtenders: extenderVisibilityStatsByMac?.median,
      maxExtenders: extenderVisibilityStatsByMac?.max,
      supervision: eventsByType(mac, "TX_TYPE_SUPERVISION", events).length > 0,
      button1: eventsByType(mac, "TX_TYPE_BUTTON_1", events).length,
      button2: eventsByType(mac, "TX_TYPE_BUTTON_2", events).length,
      button3: eventsByType(mac, "TX_TYPE_BUTTON_3", events).length,
      DryContactOpen1: eventsByType(mac, "TX_TYPE_DRY_CONTACT_OPEN_1", events)
        .length,
      DryContactClose1: eventsByType(mac, "TX_TYPE_DRY_CONTACT_CLOSE_1", events)
        .length,
      DryContactOpen2: eventsByType(mac, "TX_TYPE_DRY_CONTACT_OPEN_2", events)
        .length,
      DryContactClose2: eventsByType(mac, "TX_TYPE_DRY_CONTACT_CLOSE_2", events)
        .length,
      ReedSwitchOpen: eventsByType(mac, "TX_TYPE_REED_SWITCH_OPEN_1", events)
        .length,
      ReedSwitchClose: eventsByType(mac, "TX_TYPE_REED_SWITCH_CLOSE_1", events)
        .length,
    };
  });

  // TEST-DATA Change the button1, button2, button3 to a random number between 0 and 10 if its 0
  results.forEach((result) => {
    if (result.button1 === 0) result.button1 = Math.floor(Math.random() * 10);
    if (result.button2 === 0) result.button2 = Math.floor(Math.random() * 10);
    if (result.button3 === 0) result.button3 = Math.floor(Math.random() * 10);
    if (result.DryContactOpen1 === 0)
      result.DryContactOpen1 = Math.floor(Math.random() * 10);
    if (result.DryContactClose1 === 0)
      result.DryContactClose1 = Math.floor(Math.random() * 10);
    if (result.DryContactOpen2 === 0)
      result.DryContactOpen2 = Math.floor(Math.random() * 10);
    if (result.DryContactClose2 === 0)
      result.DryContactClose2 = Math.floor(Math.random() * 10);
    if (result.ReedSwitchOpen === 0)
      result.ReedSwitchOpen = Math.floor(Math.random() * 10);
    if (result.ReedSwitchClose === 0)
      result.ReedSwitchClose = Math.floor(Math.random() * 10);
  });

  return results;
}

function locationInfo(mac, configLocations) {
  const loc = configLocations.find((i) =>
    i.devices.some((device) => device.mac === mac)
  );

  if (!loc) return null;

  const sectionOrWing = loc.ancestors.find(
    (l) => l.locationType === "section" || l.locationType === "wing"
  );
  const floor = loc.ancestors.find((l) => l.locationType === "floor");

  return {
    building: loc.ancestors[loc.ancestors.length - 1].name,
    sectionOrWing: sectionOrWing?.name,
    floor: floor?.name,
    whereIsInstalled: loc.name,
  };
}

function getLatestDeviceEvent(mac, events) {
  const latestData = events
    .filter((i) => i.payloadType === "device-event")
    .filter((i) => i.payload.senderMac === mac)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (!latestData?.payload) return null;
  return latestData.payload;
}

function isConfigTypeMatching(configDeviceType, hardwareType) {
  if (!configDeviceType || !hardwareType) return false;
  // Find if the hardware type is in the config type list
  return typeMaps.get(hardwareType).includes(configDeviceType);
}

function getMostRecentEndDeviceFirmwareVersion(events) {
  // Get most updated incoming.network.list
  const latestData = events
    .filter((i) => i.payloadType === "extender-checkins")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (!latestData?.payload) return null;

  const networkDevices = latestData.payload.checkinList;
  const versions = networkDevices
    .map((i) => i.versions.find((v) => v.name === "End Device Firmware"))
    .filter((i) => i);

  // Here is an array of all the firmware versions in the format of {Major: number, Minor: number}, get the most recent one
  const mostRecentVersion = versions.reduce((acc, curr) => {
    if (acc.major > curr.major) return acc;
    if (acc.major < curr.major) return curr;
    if (acc.minor > curr.minor) return acc;
    return curr;
  });

  //   return `v1.1`;
  return `v${mostRecentVersion.major}.${mostRecentVersion.minor}`;
}

function getLatestEndDeviceInfo(mac, events) {
  const latestData = events
    .filter(
      (i) => i.payloadType === "device-info" && i.payload.senderMac === mac
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  return latestData?.payload ?? null;
}
function getLatestBatteryVoltage(mac, events) {
  const latestData = events
    .filter((i) => i.payloadType === "sensors" && i.payload.senderMac === mac)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  if (!latestData?.payload) return [];

  return (
    latestData.payload.sensorDataList?.filter((i) => i.Units === "Volts") ?? []
  );
}

function getExtendersVisibilityStats(events) {
  // Get all data with Receiver MAC and Sequence
  let data = events
    .filter((i) => i.payloadType === "device-event")
    .map((i) => ({
      receiverMac: i.payload.receiverMac,
      senderMac: i.payload.senderMac,
      sequence: i.payload.sequence,
    }));

  console.log("Data", data);

  let macSeqSet = new Set();
  data.forEach((item) => {
    macSeqSet.add(`${item.senderMac}-${item.sequence}`);
  });

  // For each key (sender mac and sequence), count the number of unique receiver macs
  let extenderCount = [];
  macSeqSet.forEach((key) => {
    const [senderMac, sequence] = key.split("-");
    const receiverMacsCount = data.filter(
      (i) => i.senderMac === senderMac && i.sequence === Number(sequence)
    ).length;
    extenderCount.push({
      senderMac,
      sequence,
      receiverMacsCount,
    });
  });

  return extenderCount.reduce((acc, curr) => {
    if (acc?.find((i) => i.mac === curr.senderMac)) return acc;

    const counts = extenderCount
      .filter((i) => i.senderMac === curr.senderMac)
      .map((i) => i.receiverMacsCount);

    // Debugging
    //   if (curr.senderMac === "1c:34:f1:1c:1b:94") {
    //     console.log(counts);
    //   }

    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const median = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];

    return [
      ...acc,
      {
        mac: curr.senderMac,
        min,
        max,
        median,
      },
    ];
  }, []);
}

function eventsByType(mac, eventType, events) {
  return events
    .filter((i) => i.payloadType === "device-event")
    .filter(
      (i) => i.payload.senderMac === mac && i.payload.eventType === eventType
    );
}
