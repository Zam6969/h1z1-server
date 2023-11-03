// ======================================================================
//
//   GNU GENERAL PUBLIC LICENSE
//   Version 3, 29 June 2007
//   copyright (C) 2020 - 2021 Quentin Gruber
//   copyright (C) 2021 - 2023 H1emu community
//
//   https://github.com/QuentinGruber/h1z1-server
//   https://www.npmjs.com/package/h1z1-server
//
//   Based on https://github.com/psemu/soe-network
// ======================================================================

import { ZoneServer2016 } from "../zoneserver";
const Z1_doors = require("../../../../data/2016/zoneData/Z1_doors.json");
const Z1_items = require("../../../../data/2016/zoneData/Z1_items.json");
const Z1_vehicles = require("../../../../data/2016/zoneData/Z1_vehicleLocations.json");
const Z1_npcs = require("../../../../data/2016/zoneData/Z1_npcs.json");
const Z1_lootableProps = require("../../../../data/2016/zoneData/Z1_lootableProps.json");
const Z1_taskProps = require("../../../../data/2016/zoneData/Z1_taskProps.json");
const Z1_crates = require("../../../../data/2016/zoneData/Z1_crates.json");
const Z1_destroyables = require("../../../../data/2016/zoneData/Z1_destroyables.json");
const models = require("../../../../data/2016/dataSources/Models.json");
const bannedZombieModels = require("../../../../data/2016/sampleData/bannedZombiesModels.json");
import {
  _,
  eul2quat,
  generateRandomGuid,
  isPosInRadius,
  randomIntFromInterval,
  fixEulerOrder
} from "../../../utils/utils";
import {
  EquipSlots,
  Items,
  Skins_Shirt,
  Skins_Pants,
  Skins_Beanie,
  Skins_Cap,
  Skins_MotorHelmet,
  Skins_Kevlar,
  Skins_Military,
  Skins_Glasses,
  Effects
} from "../models/enums";
import { Vehicle2016 } from "../entities/vehicle";
import { LootDefinition } from "types/zoneserver";
import { ItemObject } from "../entities/itemobject";
import { DoorEntity } from "../entities/doorentity";
import { Zombie } from "../entities/zombie";
import { BaseFullCharacter } from "../entities/basefullcharacter";
import { ExplosiveEntity } from "../entities/explosiveentity";
import { lootTables, containerLootSpawners } from "../data/lootspawns";
import { BaseItem } from "../classes/baseItem";
import { Lootbag } from "../entities/lootbag";
import { LootableProp } from "../entities/lootableprop";
import { ZoneClient2016 } from "../classes/zoneclient";
import { TaskProp } from "../entities/taskprop";
import { Crate } from "../entities/crate";
import { Destroyable } from "../entities/destroyable";
import { CharacterPlayWorldCompositeEffect } from "types/zone2016packets";
const debug = require("debug")("ZoneServer");

function getRandomSkin(itemDefinitionId: number) {
  let itemDefId = 0;
  let arr: any[] = [];
  switch (itemDefinitionId) {
    case Items.SHIRT_DEFAULT:
      arr = Object.keys(Skins_Shirt);
      break;
    case Items.PANTS_DEFAULT:
      arr = Object.keys(Skins_Pants);
      break;
    case Items.HAT_BEANIE:
      arr = Object.keys(Skins_Beanie);
      break;
    case Items.HAT_CAP:
      arr = Object.keys(Skins_Cap);
      break;
    case Items.HELMET_MOTORCYCLE:
      arr = Object.keys(Skins_MotorHelmet);
      break;
    case Items.KEVLAR_DEFAULT:
      arr = Object.keys(Skins_Kevlar);
      break;
    case Items.BACKPACK_MILITARY_TAN:
      arr = Object.keys(Skins_Military);
      break;
    case Items.ALL_PURPOSE_GOGGLES:
      arr = Object.keys(Skins_Glasses);
      break;
    default:
      return itemDefinitionId;
  }
  itemDefId = Number(arr[Math.floor((Math.random() * arr.length) / 2)]);
  return itemDefId;
}

export function getRandomItem(items: Array<LootDefinition>) {
  const totalWeight = items.reduce((total, item) => total + item.weight, 0),
    randomWeight = Math.random() * totalWeight;
  let currentWeight = 0;

  for (let i = 0; i < items.length; i++) {
    currentWeight += items[i].weight;
    if (currentWeight > randomWeight) {
      return items[i];
    }
  }
}

export class WorldObjectManager {
  spawnedNpcs: { [spawnerId: number]: string } = {};
  spawnedLootObjects: { [spawnerId: number]: string } = {};

  private _lastLootRespawnTime: number = 0;
  private _lastVehicleRespawnTime: number = 0;
  private _lastNpcRespawnTime: number = 0;

  /* MANAGED BY CONFIGMANAGER */
  vehicleSpawnCap!: number;
  minAirdropSurvivors!: number;
  lootRespawnTimer!: number;
  vehicleRespawnTimer!: number;
  npcRespawnTimer!: number;
  hasCustomLootRespawnTime!: boolean;

  itemDespawnTimer!: number;
  lootDespawnTimer!: number;
  deadNpcDespawnTimer!: number;
  lootbagDespawnTimer!: number;

  vehicleSpawnRadius!: number;
  npcSpawnRadius!: number;
  chanceNpc!: number;
  chanceScreamer!: number;

  private zombieSlots = [
    EquipSlots.HEAD,
    EquipSlots.CHEST,
    EquipSlots.LEGS,
    EquipSlots.HANDS,
    EquipSlots.FEET,
    EquipSlots.HAIR
  ];

  private getItemRespawnTimer(server: ZoneServer2016): void {
    if (this.hasCustomLootRespawnTime) return;

    const playerCount = _.size(server._characters);

    switch (true) {
      case playerCount <= 20:
        this.lootRespawnTimer = 2400000; // 40 min
        break;
      case playerCount > 20 && playerCount <= 40:
        this.lootRespawnTimer = 1800000; // 30 min
        break;
      case playerCount > 40 && playerCount <= 60:
        this.lootRespawnTimer = 1200000; // 20 min
        break;
      case playerCount > 60 && playerCount < 40:
        this.lootRespawnTimer = 600000; // 10 min
        break;
      default:
        this.lootRespawnTimer = 1200000;
    }
  }

  run(server: ZoneServer2016) {
    debug("WOM::Run");
    this.getItemRespawnTimer(server);
    if (this._lastLootRespawnTime + this.lootRespawnTimer <= Date.now()) {
      this.createLoot(server);
      this.createContainerLoot(server);
      this._lastLootRespawnTime = Date.now();
      server.divideLargeCells(700);
    }
    if (this._lastNpcRespawnTime + this.npcRespawnTimer <= Date.now()) {
      this.createNpcs(server);
      this._lastNpcRespawnTime = Date.now();
    }
    if (this._lastVehicleRespawnTime + this.vehicleRespawnTimer <= Date.now()) {
      this.createVehicles(server);
      this._lastVehicleRespawnTime = Date.now();
    }

    this.despawnEntities(server);
  }

  private npcDespawner(server: ZoneServer2016) {
    for (const characterId in server._npcs) {
      const npc = server._npcs[characterId];
      // dead npc despawner
      if (
        npc.flags.knockedOut &&
        Date.now() - npc.deathTime >= this.deadNpcDespawnTimer
      ) {
        server.deleteEntity(npc.characterId, server._npcs);
      }
    }
  }

  private lootbagDespawner(server: ZoneServer2016) {
    for (const characterId in server._lootbags) {
      // lootbag despawner
      const lootbag = server._lootbags[characterId];
      if (Date.now() - lootbag.creationTime >= this.lootbagDespawnTimer) {
        server.deleteEntity(lootbag.characterId, server._lootbags);
      }
    }
  }

  private itemDespawner(server: ZoneServer2016) {
    for (const characterId in server._spawnedItems) {
      const itemObject = server._spawnedItems[characterId];
      if (!itemObject) return;
      // dropped item despawner
      const despawnTime =
        itemObject.spawnerId == -1
          ? this.itemDespawnTimer
          : this.lootDespawnTimer;
      if (Date.now() - itemObject.creationTime >= despawnTime) {
        server.deleteEntity(itemObject.characterId, server._spawnedItems);
        switch (itemObject.item.itemDefinitionId) {
          case Items.FUEL_ETHANOL:
          case Items.FUEL_BIOFUEL:
            server.deleteEntity(itemObject.characterId, server._explosives);
            break;
        }
        if (itemObject.spawnerId != -1)
          delete this.spawnedLootObjects[itemObject.spawnerId];
        server.sendCompositeEffectToAllWithSpawnedEntity(
          server._spawnedItems,
          itemObject,
          server.getItemDefinition(itemObject.item.itemDefinitionId)
            ?.PICKUP_EFFECT ?? 5151
        );
      }
    }
  }

  private despawnEntities(server: ZoneServer2016) {
    this.npcDespawner(server);
    this.lootbagDespawner(server);
    this.itemDespawner(server);
  }

  private equipRandomSkins(
    server: ZoneServer2016,
    entity: BaseFullCharacter,
    slots: EquipSlots[],
    excludedModels: string[] = []
  ): void {
    server.generateRandomEquipmentsFromAnEntity(entity, slots, excludedModels);
  }
  createZombie(
    server: ZoneServer2016,
    modelId: number,
    position: Float32Array,
    rotation: Float32Array,
    spawnerId: number = 0
  ) {
    const characterId = generateRandomGuid();
    const zombie = new Zombie(
      characterId,
      server.getTransientId(characterId),
      modelId,
      position,
      rotation,
      server,
      spawnerId
    );
    this.equipRandomSkins(server, zombie, this.zombieSlots, bannedZombieModels);
    server._npcs[characterId] = zombie;
    if (spawnerId) this.spawnedNpcs[spawnerId] = characterId;
  }

  createLootEntity(
    server: ZoneServer2016,
    item: BaseItem | undefined,
    position: Float32Array,
    rotation: Float32Array,
    itemSpawnerId: number = -1
  ): ItemObject | undefined {
    if (!item) {
      debug(`[ERROR] Tried to createLootEntity with invalid item object`);
      return;
    }
    const itemDef = server.getItemDefinition(item.itemDefinitionId);
    if (!itemDef) {
      debug(
        `[ERROR] Tried to createLootEntity for invalid itemDefId: ${item.itemDefinitionId}`
      );
      return;
    }
    const characterId = generateRandomGuid(),
      modelId = itemDef.WORLD_MODEL_ID || 9,
      lootObj = new ItemObject(
        characterId,
        server.getTransientId(characterId),
        modelId,
        position,
        rotation,
        server,
        itemSpawnerId || 0,
        item
      );
    server._spawnedItems[characterId] = lootObj;
    server._spawnedItems[characterId].nameId = itemDef.NAME_ID;

    switch (item.itemDefinitionId) {
      case Items.FUEL_ETHANOL:
      case Items.FUEL_BIOFUEL:
        lootObj.flags.projectileCollision = 1;
        server._explosives[characterId] = new ExplosiveEntity(
          characterId,
          server.getTransientId(characterId),
          modelId,
          position,
          rotation,
          server,
          item.itemDefinitionId
        );
        break;
    }
    if (itemSpawnerId) this.spawnedLootObjects[itemSpawnerId] = characterId;
    lootObj.creationTime = Date.now();
    return lootObj;
  }

  createLootbag(server: ZoneServer2016, entity: BaseFullCharacter) {
    const characterId = generateRandomGuid(),
      isCharacter = !!server._characters[entity.characterId],
      items = entity.getDeathItems(server);

    if (!_.size(items)) return; // don't spawn lootbag if inventory is empty

    const pos = entity.state.position,
      lootbag = new Lootbag(
        characterId,
        server.getTransientId(characterId),
        isCharacter ? 9581 : 9391,
        new Float32Array([pos[0], pos[1] + 0.1, pos[2]]),
        new Float32Array([0, 0, 0, 0]),
        server
      );
    const container = lootbag.getContainer();
    if (container) {
      container.items = items;
    }

    server._lootbags[characterId] = lootbag;
    server.spawnSimpleNpcForAllInRange(lootbag);
  }

  createAirdropContainer(server: ZoneServer2016, pos: Float32Array) {
    const airdropTypes: string[] = [
      "Farmer",
      "Demolitioner",
      "Medic",
      "Builder",
      "Fighter",
      "Supplier"
    ];
    const experimentalWeapons: { weapon: number; ammo: number }[] = [
      { weapon: Items.WEAPON_REAPER, ammo: Items.AMMO_308 },
      { weapon: Items.WEAPON_BLAZE, ammo: Items.AMMO_223 },
      { weapon: Items.WEAPON_FROSTBITE, ammo: Items.AMMO_762 },
      { weapon: Items.WEAPON_NAGAFENS_RAGE, ammo: Items.AMMO_12GA }
    ];

    const index = Math.floor(Math.random() * airdropTypes.length);
    const airdropType = airdropTypes[index];
    const lootSpawner = containerLootSpawners[airdropType];

    const characterId = generateRandomGuid();

    const lootbag = new Lootbag(
      characterId,
      server.getTransientId(characterId),
      9218,
      new Float32Array([pos[0], pos[1] + 0.1, pos[2]]),
      new Float32Array([0, 0, 0, 0]),
      server
    );
    const container = lootbag.getContainer();
    if (container) {
      lootSpawner.items.forEach((item: LootDefinition) => {
        server.addContainerItem(
          lootbag,
          server.generateItem(item.item, item.spawnCount.max),
          container
        );
      });
    }
    let effectId = Effects.Smoke_Green; // default
    switch (airdropType) {
      case "Farmer":
        effectId = Effects.Smoke_Green;
        break;
      case "Demolitioner":
        effectId = Effects.Smoke_Orange;
        break;
      case "Medic":
        effectId = Effects.Smoke_Blue;
        break;
      case "Builder":
        effectId = Effects.Smoke_Purple;
        break;
      case "Fighter":
        effectId = Effects.Smoke_Red;
        if (container) {
          const experimental =
            experimentalWeapons[
              Math.floor(Math.random() * experimentalWeapons.length)
            ];
          server.addContainerItem(
            lootbag,
            server.generateItem(experimental.weapon, 1),
            container
          );
          server.addContainerItem(
            lootbag,
            server.generateItem(experimental.ammo, 30),
            container
          );
        }
        break;
      case "Supplier":
        effectId = Effects.Smoke_Yellow;
        if (container) {
          const experimental =
            experimentalWeapons[
              Math.floor(Math.random() * experimentalWeapons.length)
            ];
          server.addContainerItem(
            lootbag,
            server.generateItem(experimental.weapon, 1),
            container
          );
          server.addContainerItem(
            lootbag,
            server.generateItem(experimental.ammo, 30),
            container
          );
        }
    }
    if (server._airdrop) {
      const smokePos = new Float32Array([
        server._airdrop.destinationPos[0],
        server._airdrop.destinationPos[1] + 0.3,
        server._airdrop.destinationPos[2],
        1
      ]);
      for (const a in server._clients) {
        const c = server._clients[a];
        server.sendData<CharacterPlayWorldCompositeEffect>(
          c,
          "Character.PlayWorldCompositeEffect",
          {
            characterId: c.character.characterId,
            effectId: effectId,
            position: smokePos,
            effectTime: 60
          }
        );
      }
    }
    server._lootbags[characterId] = lootbag;
  }

  createProps(server: ZoneServer2016) {
    Z1_lootableProps.forEach((propType: any) => {
      propType.instances.forEach((propInstance: any) => {
        const characterId = generateRandomGuid();
        const obj = new LootableProp(
          characterId,
          server.getTransientId(characterId), // need transient generated for Interaction Replication
          propInstance.modelId,
          propInstance.position,
          new Float32Array([
            propInstance.rotation[1],
            propInstance.rotation[0],
            propInstance.rotation[2],
            0
          ]),
          server,
          propInstance.scale,
          propInstance.id,
          propType.renderDistance
        );
        server._lootableProps[characterId] = obj;
        obj.equipItem(server, server.generateItem(obj.containerId), false);
        obj._containers["31"].canAcceptItems = false;
        obj.nameId = server.getItemDefinition(obj.containerId)?.NAME_ID ?? 0;
      });
    });
    Z1_taskProps.forEach((propType: any) => {
      propType.instances.forEach((propInstance: any) => {
        const characterId = generateRandomGuid();
        const obj = new TaskProp(
          characterId,
          server.getTransientId(characterId), // need transient generated for Interaction Replication
          propType.modelId,
          propInstance.position,
          fixEulerOrder(propInstance.rotation),
          server,
          propInstance.scale,
          propInstance.id,
          propType.renderDistance,
          propType.actor_file
        );
        server._taskProps[characterId] = obj;
      });
    });
    Z1_crates.forEach((propType: any) => {
      propType.instances.forEach((propInstance: any) => {
        const characterId = generateRandomGuid();
        const obj = new Crate(
          characterId,
          1, // need transient generated for Interaction Replication
          propType.modelId,
          propInstance.position,
          new Float32Array([
            propInstance.rotation[1],
            propInstance.rotation[0],
            propInstance.rotation[2],
            0
          ]),
          server,
          propInstance.scale,
          propInstance.zoneId,
          propType.renderDistance,
          propType.actorDefinition
        );
        server._crates[characterId] = obj;
      });
    });
    Z1_destroyables.forEach((propType: any) => {
      // disable fences until we find a fix for glitching graphics
      if (propType.actor_file.toLowerCase().includes("fence")) return;
      propType.instances.forEach((propInstance: any) => {
        const characterId = generateRandomGuid();
        const obj = new Destroyable(
          characterId,
          1, // need transient generated for Interaction Replication
          propInstance.modelId,
          propInstance.position,
          new Float32Array([
            propInstance.rotation[1],
            propInstance.rotation[0],
            propInstance.rotation[2],
            0
          ]),
          server,
          propInstance.scale,
          propInstance.id,
          propType.renderDistance,
          propType.actor_file
        );
        server._destroyables[characterId] = obj;
        server._destroyableDTOlist.push(propInstance.id);
      });
    });
    debug("All props created");
  }

  private createDoor(
    server: ZoneServer2016,
    modelID: number,
    position: Float32Array,
    rotation: Float32Array,
    scale: Float32Array,
    spawnerId: number
  ) {
    const characterId = generateRandomGuid();
    server._doors[characterId] = new DoorEntity(
      characterId,
      server.getTransientId(characterId),
      modelID,
      position,
      rotation,
      server,
      scale,
      spawnerId
    );
  }

  createDoors(server: ZoneServer2016) {
    Z1_doors.forEach((doorType: any) => {
      const modelId: number = _.find(models, (model: any) => {
        return (
          model.MODEL_FILE_NAME ===
          doorType.actorDefinition.replace("_Placer", "")
        );
      })?.ID;
      doorType.instances.forEach((doorInstance: any) => {
        this.createDoor(
          server,
          modelId ? modelId : 9183,
          doorInstance.position,
          doorInstance.rotation,
          doorInstance.scale ?? [1, 1, 1, 1],
          doorInstance.id
        );
      });
    });
    debug("All doors objects created");
  }

  setSpawnchance(
    server: ZoneServer2016,
    entity: BaseFullCharacter,
    percentage: number,
    item: Items
  ) {
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;

    const randomNumber = Math.random() * 100;
    if (randomNumber <= percentage) {
      entity.lootItem(server, server.generateItem(item));
    }
  }

  createVehicle(server: ZoneServer2016, vehicle: Vehicle2016) {
    vehicle.equipLoadout(server);

    this.setSpawnchance(server, vehicle, 50, Items.BATTERY);
    this.setSpawnchance(server, vehicle, 50, Items.SPARKPLUGS);
    this.setSpawnchance(server, vehicle, 30, Items.VEHICLE_KEY);
    this.setSpawnchance(server, vehicle, 20, Items.FUEL_BIOFUEL);
    this.setSpawnchance(server, vehicle, 30, vehicle.getHeadlightsItemId());
    this.setSpawnchance(server, vehicle, 30, vehicle.getTurboItemId());

    server._vehicles[vehicle.characterId] = vehicle;
  }

  createVehicles(server: ZoneServer2016) {
    if (_.size(server._vehicles) >= this.vehicleSpawnCap) return;
    const respawnAmount = Math.ceil(
      (this.vehicleSpawnCap - _.size(server._vehicles)) / 8
    );
    for (let x = 0; x < respawnAmount; x++) {
      const dataVehicle =
        Z1_vehicles[randomIntFromInterval(0, Z1_vehicles.length - 1)];
      let spawn = true;
      Object.values(server._vehicles).forEach((spawnedVehicle: Vehicle2016) => {
        if (!spawn) return;
        if (
          isPosInRadius(
            this.vehicleSpawnRadius,
            dataVehicle.position,
            spawnedVehicle.state.position
          )
        ) {
          spawn = false;
        }
      });
      if (!spawn) {
        continue;
      }
      const characterId = generateRandomGuid(),
        vehicleData = new Vehicle2016(
          characterId,
          server.getTransientId(characterId),
          0,
          new Float32Array(dataVehicle.position),
          new Float32Array(dataVehicle.rotation),
          server,
          server.getGameTime(),
          dataVehicle.vehicleId
        );
      vehicleData.positionUpdate.orientation = dataVehicle.orientation;
      this.createVehicle(server, vehicleData); // save vehicle
    }
    debug("All vehicles created");
  }

  createNpcs(server: ZoneServer2016) {
    // This is only for giving the world some life
    Z1_npcs.forEach((spawnerType: any) => {
      const authorizedModelId: number[] = [];
      switch (spawnerType.actorDefinition) {
        case "NPCSpawner_ZombieLazy.adr":
          authorizedModelId.push(9510);
          authorizedModelId.push(9634);
          break;
        case "NPCSpawner_ZombieWalker.adr":
          authorizedModelId.push(9510);
          authorizedModelId.push(9634);
          break;
        case "NPCSpawner_Deer001.adr":
          authorizedModelId.push(9002);
          break;
          case "ArmoredZombie01.adr":
            authorizedModelId.push(10829);
            break;
          case "NPCSpawner_Deer001.adr":
                      authorizedModelId.push(9002);
                      break;
          case "Rabbit_Tan.adr":
                      authorizedModelId.push(9212);
                      break;
          case "Brown_Bear.adr":
                      authorizedModelId.push(9187);
                      break;
          case "Wolf001.adr":
                      authorizedModelId.push(9003);
                      break;
          case "City_Props_Tree01.adr":
                      authorizedModelId.push(9776);
                      break;
          case "City_Props_StreetLight.adr":
                      authorizedModelId.push(9775);
                      break;
          case "City_Structures_Buildings_Int_WallHole01.adr":
                      authorizedModelId.push(9809);
                      break;
          case "BaseBuilding_Structures_Modular_Wall01_T1.adr":
                      authorizedModelId.push(10107);
                      break;
          case "Common_DPO_DoorProxy_Residential.adr":
                      authorizedModelId.push(9883);
                      break;
          case "Doors_Commercial_01.adr":
                      authorizedModelId.push(9884);
                      break;
          case "Doors_Business_Glass.adr":
                      authorizedModelId.push(9897);
                      break;
          case "Industrial_Props_Barriers_CrowdBarrier01.adr":
                      authorizedModelId.push(10010);
                      break;
          case "Dam_Props_LightEmergency.adr":
                      authorizedModelId.push(10018);
                      break;
          case "City_Structures_Blockade_Floodlight01.adr":
                      authorizedModelId.push(10024);
                      break;
          case "Common_Props_MilitaryBase_HighFence1x1_Corner.adr":  //CORNER
                      authorizedModelId.push(10035);
                      break;
          case "Common_Props_MilitaryBase_HighFence1x1.adr":  //HIGH FENCE
                      authorizedModelId.push(10036);
                      break;
          case "Common_Props_MilitaryBase_HighFence1x2.adr":  //HIGH FENCE X2
                      authorizedModelId.push(10037);
                      break;
          case "Common_Structures_Carport01.adr":
                      authorizedModelId.push(46);
                      break;
          case "Common_Structures_Farm_Shed01.adr":
                      authorizedModelId.push(47);
                      break;
          case "Common_Props_CargoContainer01_Lights.adr":
                      authorizedModelId.push(9384);
                      break;
          case "Common_Structures_Proxy_PitchedRoof.adr":
                      authorizedModelId.push(8008);
                      break;
          case "Common_Structures_Proxy_SolidWall.adr":
                      authorizedModelId.push(8009);
                      break;
          case "Common_Structures_Houses_Shed.adr":
                      authorizedModelId.push(9075);
                      break;
          case "Common_Structures_Houses_ShedDoor.adr":
                      authorizedModelId.push(9076);
                      break;
          case "Common_Props_WreckedCar01_Destroyed.adr":
                      authorizedModelId.push(9107);
                      break;
          case "Common_Props_WreckedTruck01.adr":
                      authorizedModelId.push(9108);
                      break;
          case "Common_Props_WreckedVan01.adr":
                      authorizedModelId.push(9110);
                      break;
          case "Common_Structures_Houses_House35.adr":
                      authorizedModelId.push(11167);
                      break;
          case "Common_Props_Auto_Mech_TrashCan_Fire.adr":
                      authorizedModelId.push(9373);
                      break;
          case "Common_Structures_Proxy_PitchedRoof.adr":
                      authorizedModelId.push(8008);
                      break;
          case "Industrial_Props_Towers_WaterTower_Tower01.adr":
                      authorizedModelId.push(11165);
                      break;
          case "RainbowTroutA.adr":
                      authorizedModelId.push(11168);
                      break;
          case "Common_Props_Bicycle01.adr":
                      authorizedModelId.push(11166);
                      break;
          case "MTX_Props_Bobcat_tax.adr":
                      authorizedModelId.push(11169);
                      break;
          case "Common_Structures_Houses_SmallHouse03.adr":
                  authorizedModelId.push(11170);
                  break;
          case "Common_Structures_Houses_CabinLarge.adr":
                      authorizedModelId.push(11171);
                      break;
          case "Common_Structures_Houses_House37.adr":
                      authorizedModelId.push(11172);
                      break;
          case "Common_Structures_Houses_House01.adr":
                      authorizedModelId.push(11173);
                      break;
          case "Common_Structures_Houses_House24.adr":
                      authorizedModelId.push(11174);
                      break;
          case "Common_Structures_Houses_House36B.adr":
                      authorizedModelId.push(11175);
                      break;
          case "Common_Structures_PoliceStation02.adr":
                      authorizedModelId.push(11176);
                      break;
          case "Common_Structures_Church_Stucco01.adr":
                      authorizedModelId.push(11177);
                      break;
          case "Common_Structures_StorelLevel03.adr":
                      authorizedModelId.push(11178);
                      break;
          case "Common_Structures_StoreFront02.adr":
                      authorizedModelId.push(11179);
                      break;
          case "Common_Structures_Firehouse.adr":
                      authorizedModelId.push(11180);
                      break;
          case "Common_Props_TransmissionTower01.adr":
                      authorizedModelId.push(11181);
                      break;
          case "Common_Structures_HardwareStore01.adr":
                      authorizedModelId.push(11182);
                      break;
          case "Common_Structures_Houses_SmallHouse05.adr":
                      authorizedModelId.push(11183);
                      break;
          case "Common_Structures_Houses_House34B.adr":
                      authorizedModelId.push(11184);
                      break;
          case "Common_Structures_Houses_SmallHouse04.adr":
                      authorizedModelId.push(11185);
                      break;
          case "Common_Structures_Houses_SmallHouse06.adr":
                  authorizedModelId.push(11186);
                      break;
          case "Common_Structures_Houses_House12a.adr":
                      authorizedModelId.push(11187);
                      break;
          case "Common_Structures_Houses_House34B.adr":
                      authorizedModelId.push(11188);
                      break;
          case "Common_Structures_Houses_House16.adr":
                      authorizedModelId.push(11189);
                      break;
          case "Common_Structures_Houses_House21.adr":
                      authorizedModelId.push(11190);
                      break;
          case "Common_Structures_HardwareStore01.adr":
                      authorizedModelId.push(11191);
                      break;
          case "Common_Props_PowerPole02.adr":
                      authorizedModelId.push(11192);
                      break;
          case "Common_Props_StreetLight01.adr":
                      authorizedModelId.push(11193);
                      break;
          case "Farm_Structures_Buildings_Barn01.adr":
                      authorizedModelId.push(11194);
                      break;
          case "Farm_Structures_Buildings_Barn01_Weathervane.adr":
                      authorizedModelId.push(11195);
                      break;
          case "Farm_Structures_Buildings_Barn01_Weathervane_Top.adr":
                      authorizedModelId.push(11196);
                      break;
          case "Common_Structures_Apartments_Apartment01.adr":
                      authorizedModelId.push(11197);
                      break;
          case "Vehicle_Devil01.adr":
                      authorizedModelId.push(11198);
                      break;
          case "Vehicle_Devil02.adr":
                      authorizedModelId.push(11199);
                      break;
          case "Common_Structures_PoliceStation02.adr":
                      authorizedModelId.push(11200);
                      break;
          case "Common_Props_Boulders_Moss03.adr":
                      authorizedModelId.push(11201);
                      break;
          case "Common_Props_Gravestone01.adr":
                      authorizedModelId.push(11202);
                      break;
          case "Common_Props_Gravestone02.adr":
                      authorizedModelId.push(11203);
                      break;
          case "Common_Structures_MilitaryBase_TentOpen.adr":
                      authorizedModelId.push(11204);
                      break;
          case "Common_Props_MilitaryBase_HescoBarrier.adr":
                      authorizedModelId.push(11205);
                      break;
          case "Common_Props_Target_Round10cmRings.adr":
                      authorizedModelId.push(11206);
                      break;
          case "Common_Props_PicNicTable_01.adr":
                      authorizedModelId.push(11207);
                      break;
          case "Common_Props_MilitaryBase_BunkBed.adr":
                      authorizedModelId.push(11208);
                      break;
          case "Common_Props_Bedroom_BedCombined03.adr":
                      authorizedModelId.push(11209);
                      break;
          case "Common_Props_Cabinets_Bathroom01.adr":
                      authorizedModelId.push(11210);
                      break;
          case "Common_Props_Bathroom_Toilet01.adr":
                      authorizedModelId.push(11211);
                      break;
          case "Common_Props_Furniture_Dresser02_Rustic.adr":
                      authorizedModelId.push(11212);
                      break;
          case "Common_Props_Furniture_Armoire02_Rustic.adr":
                      authorizedModelId.push(11213);
                      break;
          case "Common_Props_Bedroom_NightStand01.adr":
                      authorizedModelId.push(11214);
                      break;
          case "Common_Props_LivingRoom_EntertainmentCenter01.adr":
                      authorizedModelId.push(11215);
                      break;
          case "Common_Props_LivingRoom_CoffeeTable01.adr":
                      authorizedModelId.push(11216);
                      break;
          case "Common_Props_Furniture_CafeTable01.adr":
                      authorizedModelId.push(11217);
                      break;
          case "Common_Props_LivingRoom_Sofa01.adr":
                      authorizedModelId.push(11218);
                      break;
          case "Common_Props_LivingRoom_Chair01.adr":
                      authorizedModelId.push(11219);
                      break;
          case "Common_Props_Bedroom_LampFloor03.adr":
                      authorizedModelId.push(11220);
                      break;
          case "Common_Props_Cabinets_CabinetSet06.adr":
                      authorizedModelId.push(11221);
                      break;
          case "Common_Props_Cabinets_CabinetSet04.adr":
                      authorizedModelId.push(11222);
                      break;
          case "Common_Props_Cabinets_Kitchen03.adr":
                      authorizedModelId.push(11223);
                      break;
          case "Common_Props_Kitchen_Fridge.adr":
                      authorizedModelId.push(11224);
                      break;
          case "Common_Props_Cabinets_Kitchen02.adr":
                      authorizedModelId.push(11225);
                      break;
          case "Common_Props_Furniture_BathTub01.adr":
                      authorizedModelId.push(11226);
                      break;
          case "Common_Props_LivingRoom_Bookcase01.adr":
                      authorizedModelId.push(11227);
                      break;
          case "Common_Props_Furniture_Piano01.adr":
                      authorizedModelId.push(11228);
                      break;
          case "Common_Props_Washer.adr":
                      authorizedModelId.push(11229);
                      break;
          case "Common_Props_Dryer.adr":
                      authorizedModelId.push(11230);
                      break;
          case "Common_Structures_Warehouse01.adr":
                      authorizedModelId.push(11231);
                      break;
          case "Hospital_Props_BodyBag02.adr":
                      authorizedModelId.push(11232);
                      break;
          case "Common_Props_WasherDryerCombo.adr":
                      authorizedModelId.push(11233);
                      break;
          case "Common_Props_Fences_WoodPlanksGreyPosts1x2.adr":
                      authorizedModelId.push(11234);
                      break;
          case "Fairgrounds_Props_FairSigns_Rect.adr":
                      authorizedModelId.push(11235);
                      break;
          case "Roads_Props_POISigns_FairSign.adr":
                      authorizedModelId.push(11236);
                      break;
          case "Roads_Props_POISigns_MortonsSign.adr":
                      authorizedModelId.push(11237);
                      break;
          case "Roads_Props_POISigns_RiverRidgeSign.adr":
                      authorizedModelId.push(11238);
                      break;
          case "Roads_Props_Signs_Miles_01.adr":
                      authorizedModelId.push(11239);
                      break;
          case "Roads_Props_Signs_Miles_02.adr":
                      authorizedModelId.push(11240);
                      break;
          case "Roads_Props_Signs_Miles_03.adr":
                      authorizedModelId.push(11241);
                      break;
          case "Normandy_Props_Trees_Dead01.adr":
                      authorizedModelId.push(8007);
                      break;
                  default:
                      break;
      }
      
      if (!authorizedModelId.length) return;
      spawnerType.instances.forEach((npcInstance: any) => {
        let spawn = true;
        Object.values(server._npcs).every((spawnedNpc: Zombie) => {
          if (
            isPosInRadius(
              this.npcSpawnRadius,
              npcInstance.position,
              spawnedNpc.state.position
            )
          ) {
            spawn = false;
            return false;
          }
          return true;
        });
        if (!spawn) return;
        const spawnchance = Math.floor(Math.random() * 100) + 1; // temporary spawnchance
        if (spawnchance <= this.chanceNpc) {
          const screamerChance = Math.floor(Math.random() * 1000) + 1; // temporary spawnchance
          if (screamerChance <= this.chanceScreamer) {
            authorizedModelId.push(9667);
          }
          this.createZombie(
            server,
            authorizedModelId[
              Math.floor(Math.random() * authorizedModelId.length)
            ],
            npcInstance.position,
            new Float32Array(eul2quat(npcInstance.rotation)),
            npcInstance.id
          );
        }
      });
    });
    debug("All npcs objects created");
  }

  createLoot(server: ZoneServer2016, lTables = lootTables) {
    Z1_items.forEach((spawnerType: any) => {
      const lootTable = lTables[spawnerType.actorDefinition];
      if (lootTable) {
        spawnerType.instances.forEach((itemInstance: any) => {
          if (this.spawnedLootObjects[itemInstance.id]) return;
          const chance = Math.floor(Math.random() * 100) + 1; // temporary spawnchance
          if (chance <= lootTable.spawnChance) {
            // temporary spawnchance
            const item = getRandomItem(lootTable.items);
            if (item) {
              this.createLootEntity(
                server,
                server.generateItem(
                  getRandomSkin(item.item),
                  randomIntFromInterval(
                    item.spawnCount.min,
                    item.spawnCount.max
                  )
                ),
                itemInstance.position,
                itemInstance.rotation,
                itemInstance.id
              );
            }
          }
        });
      }
    });
  }
  createContainerLoot(server: ZoneServer2016) {
    for (const a in server._lootableProps) {
      const prop = server._lootableProps[a] as LootableProp;
      const container = prop.getContainer();
      if (!container) continue;
      if (!!Object.keys(container.items).length) continue; // skip if container is not empty
      const lootTable = containerLootSpawners[prop.lootSpawner];
      if (lootTable) {
        for (let x = 0; x < lootTable.maxItems; x++) {
          const item = getRandomItem(lootTable.items);
          if (!item) continue;
          const chance = Math.floor(Math.random() * 100) + 1; // temporary spawnchance
          let allow = true;
          Object.values(container.items).forEach((spawnedItem: BaseItem) => {
            if (item.item == spawnedItem.itemDefinitionId) allow = false; // dont allow the same item to be added twice
          });
          if (allow) {
            if (chance <= item.weight) {
              const count = Math.floor(
                Math.random() *
                  (item.spawnCount.max - item.spawnCount.min + 1) +
                  item.spawnCount.min
              );
              // temporary spawnchance
              server.addContainerItem(
                prop,
                server.generateItem(getRandomSkin(item.item), count),
                container
              );
            }
          } else {
            x--;
          }
        }
      }
      if (Object.keys(container.items).length != 0) {
        // mark prop as unsearched for clients
        Object.values(server._clients).forEach((client: ZoneClient2016) => {
          const index = client.searchedProps.indexOf(prop);
          if (index > -1) {
            client.searchedProps.splice(index, 1);
          }
        });
      }
    }
  }
}
