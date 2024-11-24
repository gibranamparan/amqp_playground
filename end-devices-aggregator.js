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

  const flavorTypesToDiscard = [
    "pendant",
    "extender",
    "director",
    "headend-power",
  ];

  configDevices
    .filter((i) => !flavorTypesToDiscard.includes(i.flavor))
    .forEach((item) => {
      devicesMacSet.add(item.mac);
    });

  const extenderVisibilityStats = getExtendersVisibilityStats(events);
  // Prepare the report results
  let results = Array.from(devicesMacSet).map((mac) => {
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

    const deviceTriggers =
      configDevice.transmitterProfile?.transmitterTypeMappings.map((i) => {
        // Count how many different extenders have received the event
        const counts = new Set(
          eventsByType(mac, i.txType, events).map((i) => i.payload.receiverMac)
        );
        return {
          txType: i.txType,
          // pass: counts.size > 2,
          pass: Math.random() < 0.9 && !!configDeviceType,
        };
      }) ?? [];

    console.log("deviceTriggers", deviceTriggers);

    return {
      mac,
      isInConfig: !!configDevice,
      building: locInfo?.building ?? null,
      sectionOrWing: locInfo?.sectionOrWing ?? null,
      floor: locInfo?.floor ?? null,
      location: locInfo?.whereIsInstalled ?? null,
      locationId: locInfo?.whereIsInstalledId ?? null,
      deviceName: configDevice?.name,
      transmitterProfile: configDevice?.transmitterProfile?.name,
      deviceType: configDeviceType,
      hardwareType: latestDeviceType,
      isMatchingTypes: isConfigTypeMatching(configDeviceType, latestDeviceType),
      firmwareVersion,
      isFirmwareUpToDate:
        firmwareVersion === mostRecentEndDeviceFirmwareVersion,
      batteryVoltage: latestBatteryVoltage[0]?.value ?? null, // No data available
      minExtenders: extenderVisibilityStatsByMac?.min ?? null,
      medianExtenders: extenderVisibilityStatsByMac?.median,
      maxExtenders: extenderVisibilityStatsByMac?.max,
      deviceTriggers,
      supervisionsCount:
        eventsByType(mac, "TX_TYPE_SUPERVISION", events).length > 0,
    };
  });

  // TEST-DATA Change the button1, button2, button3 to a random number between 0 and 10 if its 0
  results = results.map((i) => {
    i.supervisionsPercentage =
      Math.floor((0.75 + 0.25 * Math.random()) * 10000) / 100;

    return {
      mac: i.mac,
      deviceName: i.deviceName,
      configType: i.deviceType,
      hardwareType: i.hardwareType,
      transmitterProfile: i.transmitterProfile,
      firmwareVersion: i.firmwareVersion,
      batteryVoltage: i.batteryVoltage,
      location: {
        building: i.building,
        sectionOrWing: i.sectionOrWing,
        floor: i.floor,
        place: i.location,
        placeId: i.locationId,
      },
      deviceTriggersCriteria: i.deviceTriggers,
      criteria: {
        isMatchingTypes: i.isMatchingTypes,
        isFirmwareUpToDate: i.isFirmwareUpToDate,
        isSupervisionPassing: Math.random() < 0.8 && !!i.hardwareType,
        isBatteryAcceptable: i.batteryVoltage > 2.85,
        isDeviceTriggersPassing:
          i.deviceTriggers.every((i) => i.pass) && i.deviceTriggers.length > 0,
      },
    };
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
    whereIsInstalledId: loc.id,
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
    latestData.payload.sensorDataList?.filter((i) => i.units === "Volts") ?? []
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
    //    console.log("counts", counts);
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
