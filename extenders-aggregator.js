export function calculateExtenderMetrics(
  configLocations,
  configDevices,
  events
) {
  // Collect all the MAC addresses from config and events
  const extendersMacSet = new Set();
  events
    .filter((i) => i.payloadType === "extender-checkins")
    .map((i) => i.payload.checkinList)
    .flat()
    .forEach((i) => extendersMacSet.add(i.mac));
  configDevices.forEach((device) => {
    if (device.flavor === "extender") {
      extendersMacSet.add(insertFFEFIntoMac(device.mac));
    }
  });

  let maxMenderArtifact = getMaxVersion(events, "Mender Artifact");
  let maxEndDeviceFirmware = getMaxVersion(events, "End Device Firmware");

  const results = Array.from(extendersMacSet).map((mac) => {
    const macForConfig = removeFFEFFromMac(mac);
    const configDevice = configDevices.find(
      (device) => device.mac === macForConfig
    );

    const extenderActivity = calculateExtenderActivity(mac, events);
    const locInfo = locationInfo(macForConfig, configLocations);
    const latestCheckin = getLatestCheckinByMac(mac, events);
    const hardwareType =
      latestCheckin?.alias === "00:00" ? "director" : "extender";
    const versions = latestCheckin?.versions ?? [];
    let menderArtifact = versions.find((i) => i.name === "Mender Artifact");

    menderArtifact =
      (menderArtifact &&
        `${menderArtifact.major}.${menderArtifact.minor}.${menderArtifact.build}`) ??
      null;

    let endDeviceFirmwareVersion = versions.find(
      (i) => i.name === "End Device Firmware"
    );
    endDeviceFirmwareVersion =
      (endDeviceFirmwareVersion &&
        `${endDeviceFirmwareVersion.major}.${endDeviceFirmwareVersion.minor}.${endDeviceFirmwareVersion.build}`) ||
      null;

    return {
      mac,
      deviceName: configDevice?.name ?? null,
      hardwareType,
      panId: latestCheckin?.zigbeeExtPanId ?? null,
      location: {
        building: locInfo?.building ?? null,
        sectionOrWing: locInfo?.sectionOrWing ?? null,
        floor: locInfo?.floor ?? null,
        place: locInfo?.whereIsInstalled ?? null,
        placeId: locInfo?.whereIsInstalledId,
      },
      menderArtifact,
      endDeviceFirmwareVersion,
      zigbeeActivePercentage: extenderActivity.zigbeeActivePercentage,
      wifiActivePercentage: extenderActivity.wifiActivePercentage,
      neighborsCount: Math.floor(Math.random() * 10),
      criteria: {
        isMenderArtifactUpToDate: menderArtifact === maxMenderArtifact,
        isEndDeviceFirmwareUpToDate:
          endDeviceFirmwareVersion === maxEndDeviceFirmware,
        isZigbeeActivityAcceptable:
          extenderActivity.zigbeeActivePercentage > 90,
        isWifiActivityAcceptable: extenderActivity.wifiActivePercentage > 90,
        isNumberOfNeighborsAcceptable: Math.random() < 0.8,
        isLqiAcceptable: Math.random() < 0.8,
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

function getLatestCheckinByMac(mac, events) {
  const data = events.filter(
    (i) =>
      i.payloadType === "extender-checkins" &&
      i.payload.checkinList.some((i) => i.mac === mac)
  );
  data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const checkinlist = (data[0] && data[0].payload.checkinList) || [];
  return checkinlist.find((i) => i.mac === mac);
}

function getMaxVersion(events, name) {
  const data = events.filter((i) => i.payloadType === "extender-checkins");
  const checkinlists = data
    .flatMap((i) => i.payload.checkinList)
    .filter((i) => i?.versions.length > 0);

  const menders = checkinlists
    .flatMap((i) => i.versions)
    .filter((i) => i.name === name);

  if (menders.length === 0) {
    return null;
  }

  // Find the max version
  const maxVersion = menders.reduce((max, current) => {
    if (max.major > current.major) {
      return max;
    } else if (max.major < current.major) {
      return current;
    } else if (max.minor > current.minor) {
      return max;
    } else if (max.minor < current.minor) {
      return current;
    } else if (max.build > current.build) {
      return max;
    } else {
      return current;
    }
  });

  return `${maxVersion.major}.${maxVersion.minor}.${maxVersion.build}`;
}

function calculateExtenderActivity(mac, events) {
  const checkins = events
    .filter((i) => i.payloadType === "extender-checkins")
    .flatMap((i) => i.payload.checkinList);

  const zigbeeTotalCount = checkins.filter(
    (i) => i.transport == "zigbee"
  ).length;
  const wifiTotalCount = checkins.filter((i) => i.transport == "wifi").length;
  const zigbeeActiveCount = checkins.filter(
    (i) => i.transport === "zigbee" && i.active === true
  ).length;
  const wifiActiveCount = checkins.filter(
    (i) => i.transport === "wifi" && i.active === true
  ).length;
  return {
    zigbeeActivePercentage: (100 * zigbeeActiveCount) / zigbeeTotalCount,
    wifiActivePercentage: (100 * wifiActiveCount) / wifiTotalCount,
  };
}

function insertFFEFIntoMac(mac) {
  return mac.slice(0, 9) + "ff:fe:" + mac.slice(9);
}

function removeFFEFFromMac(mac) {
  return mac.slice(0, 9) + mac.slice(15);
}

function getAllPanIds(events) {
  const checkins = events
    .filter((i) => i.payloadType === "extender-checkins")
    .flatMap((i) => i.payload.checkinList);

  return Array.from(new Set(checkins.map((i) => i.zigbeeExtPanId)));
}
