import { BigInt, ByteArray, Address, Bytes, crypto, log, BigDecimal, ipfs, json, JSONValue, JSONValueKind } from '@graphprotocol/graph-ts'
import {
Contract,
Subgraph,
GraphAccount,
SubgraphDeployment,
SubgraphVersion,
Network,
ContractEvent,
CurrentSubgraphDeploymentRelation
} from './types/schema'

export function convertBigIntSubgraphIDToBase58(bigIntRepresentation: BigInt): String {
  // Might need to unpad the BigInt since `fromUnsignedBytes` pads one byte with a zero.
  // Although for the events where the uint256 is provided, we probably don't need to unpad.
  let hexString = bigIntRepresentation.toHexString()
  if (hexString.length % 2 != 0) {
    log.error('Hex string not even, hex: {}, original: {}. Padding it to even length', [
      hexString,
      bigIntRepresentation.toString(),
    ])
    hexString = '0x0' + hexString.slice(2)
  }
  let bytes = ByteArray.fromHexString(hexString)
  return bytes.toBase58()
}

export function createOrLoadGraphAccount(graphAccountID: Bytes): GraphAccount {
  let id = graphAccountID.toHexString()
  let graphAccount = GraphAccount.load(id)
  if(graphAccount == null) {
    graphAccount = new GraphAccount(id)
    graphAccount.save()
  }
  return graphAccount as GraphAccount
}

export function createOrLoadSubgraph(bigIntID: BigInt, timestamp: BigInt): Subgraph {
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)
  if(subgraph == null) {
    subgraph = new Subgraph(subgraphID)
    subgraph.createdAt = timestamp.toI32()
    subgraph.active = true
    subgraph.owner = ""
    subgraph.entityVersion = 2
    subgraph.versionCount = BigInt.fromI32(0)
    subgraph.signalledTokens = BigInt.fromI32(0)
    subgraph.unsignalledTokens = BigInt.fromI32(0)
    subgraph.currentSignalledTokens = BigInt.fromI32(0)
    subgraph.save()
  }
  return subgraph as Subgraph
}

export function createOrLoadContract(contractID: String): Contract {
  let contract = Contract.load(contractID)
  if(contract == null) {
    contract = new Contract(contractID)
    contract.save()
  }
  return contract as Contract
}

export function createOrLoadContractEvent(contractID: String,event: String): ContractEvent {
// TODO This could really benefit from the use of name mangling, if possible.  There might be contract event redundancies without it.
  let contractEvent = ContractEvent.load(joinID([contractID,event]))
  if(contractEvent == null) {
    contractEvent = new ContractEvent(joinID([contractID,event]))
  }
  contractEvent.contract = contractID
  contractEvent.event = event
  contractEvent.save()
  return contractEvent as ContractEvent
}

export function addQm(a: ByteArray): ByteArray {
  let out = new Uint8Array(34)
  out[0] = 0x12
  out[1] = 0x20
  for (let i = 0; i < 32; i++) {
    out[i + 2] = a[i]
  }
  return changetype<ByteArray>(out)
}

export function getSubgraphID(graphAccount: Address, subgraphNumber: BigInt): BigInt {
  let graphAccountStr = graphAccount.toHexString()
  let subgraphNumberStr = subgraphNumber.toHexString().slice(2)
  let number = subgraphNumberStr.padStart(64, '0')
  let unhashedSubgraphID = graphAccountStr.concat(number)
  let hashedId = Bytes.fromByteArray(crypto.keccak256(ByteArray.fromHexString(unhashedSubgraphID)))
  let bigIntRepresentation = BigInt.fromUnsignedBytes(changetype<Bytes>(hashedId.reverse()))
  return bigIntRepresentation
}

export function joinID(pieces: Array<string>): string {
  return pieces.join('-')
}

export function jsonToString(val: JSONValue | null): string {
  if (val != null && val.kind === JSONValueKind.STRING) {
    return val.toString()
  }
  return ''
}

export function fetchSubgraphMetadata(subgraph: Subgraph, ipfsHash: string): Subgraph {
  let metadata = ipfs.cat(ipfsHash)
  if (metadata !== null) {
    let tryData = json.try_fromBytes(metadata as Bytes)
    if (tryData.isOk) {
      let data = tryData.value.toObject()
      subgraph.description = jsonToString(data.get('description'))
      subgraph.displayName = jsonToString(data.get('displayName'))
      subgraph.codeRepository = jsonToString(data.get('codeRepository'))
      subgraph.website = jsonToString(data.get('website'))
/* TODO - V2
      let categories = data.get('categories')

      if(categories != null && !categories.isNull()) {
        let categoriesArray = categories.toArray()

        for(let i = 0; i < categoriesArray.length; i++) {
          let categoryId = jsonToString(categoriesArray[i])
          createOrLoadSubgraphCategory(categoryId)
          createOrLoadSubgraphCategoryRelation(categoryId, subgraph.id)
          if(subgraph.linkedEntity != null) {
            createOrLoadSubgraphCategoryRelation(categoryId, subgraph.linkedEntity!)
          }
        }
      }
*/
      let image = jsonToString(data.get('image'))
      let subgraphImage = data.get('subgraphImage')
      if (subgraphImage != null && subgraphImage.kind === JSONValueKind.STRING)  {
        //subgraph.nftImage = image
        subgraph.image = jsonToString(subgraphImage)
      } else {
        subgraph.image = image
      }
    }
  }
  return subgraph
}

export function fetchSubgraphVersionMetadata(subgraphVersion: SubgraphVersion, ipfsHash: string): SubgraphVersion {
  let getVersionDataFromIPFS = ipfs.cat(ipfsHash)
  if (getVersionDataFromIPFS !== null) {
    let tryData = json.try_fromBytes(getVersionDataFromIPFS as Bytes)
    if (tryData.isOk) {
      let data = tryData.value.toObject()
      subgraphVersion.description = jsonToString(data.get('description'))
      subgraphVersion.label = jsonToString(data.get('label'))
    } else {
      subgraphVersion.description = ''
      subgraphVersion.label = ''
    }
  }
  return subgraphVersion
}

export function createOrLoadNetwork(id: string): Network {
  let network = Network.load(id)
  if (network == null) {
    network = new Network(id)
    network.save()
  }
  return network as Network
}

export function fetchSubgraphDeploymentManifest(deployment: SubgraphDeployment, ipfsHash: string): SubgraphDeployment {
  let getManifestFromIPFS = ipfs.cat(ipfsHash)
  if (getManifestFromIPFS !== null) {
    deployment.manifest = getManifestFromIPFS.toString()

    let manifest = deployment.manifest!
    // we take the right side of the split, since it's the one which will have the schema ipfs hash
    let schemaSplit = manifest.split('schema:\n', 2)[1]
    let schemaFileSplit = schemaSplit.split('/ipfs/', 2)[1]
    let schemaIpfsHash = schemaFileSplit.split('\n', 2)[0]
    deployment.schemaIpfsHash = schemaIpfsHash

    let getSchemaFromIPFS = ipfs.cat(schemaIpfsHash)
    if (getSchemaFromIPFS !== null) {
      deployment.schema = getSchemaFromIPFS.toString()
    }

    // We get the first occurrence of `network` since subgraphs can only have data sources for the same network
    let networkSplit = manifest.split('network: ', 2)[1]
    let network = networkSplit.split('\n', 2)[0]

    createOrLoadNetwork(network)
    deployment.network = network
  }
  return deployment as SubgraphDeployment
}

export function createOrLoadSubgraphVersion(subgraph: Subgraph, deployment: SubgraphDeployment): SubgraphVersion {
  let versionID = joinID([subgraph.id, subgraph.versionCount.toString()])
  subgraph.currentVersion = versionID
  subgraph.versionCount = subgraph.versionCount.plus(BigInt.fromI32(1))
  subgraph.save()
  
  let subgraphVersion = SubgraphVersion.load(versionID)
  if(subgraphVersion == null) {
    subgraphVersion = new SubgraphVersion(versionID)
  }
  subgraphVersion.subgraph = subgraph.id
  subgraphVersion.subgraphDeployment = deployment.id
  let versionNumber = subgraph.versionCount
  subgraphVersion.version = versionNumber.toI32()
  subgraphVersion.save()
  return subgraphVersion as SubgraphVersion
}

export function createOrLoadSubgraphDeployment(
  subgraphID: string
): SubgraphDeployment {
  let deployment = SubgraphDeployment.load(subgraphID)
  if (deployment == null) {
    let prefix = '1220'
    deployment = new SubgraphDeployment(subgraphID)
    deployment.ipfsHash = Bytes.fromHexString(prefix.concat(subgraphID.slice(2))).toBase58()
    deployment = fetchSubgraphDeploymentManifest(
      deployment as SubgraphDeployment,
      deployment.ipfsHash,
    )

    deployment.subgraphCount = 0
    deployment.activeSubgraphCount = 0
    deployment.deprecatedSubgraphCount = 0
    deployment.save()
  }
  return deployment as SubgraphDeployment
}

export function duplicateOrUpdateSubgraphWithNewID(entity: Subgraph, newID: String, newEntityVersion: i32): Subgraph {
  let subgraph = Subgraph.load(newID)
  if (subgraph == null) {
    subgraph = new Subgraph(newID)
  }
  subgraph.owner = entity.owner
  //subgraph.currentVersion = entity.currentVersion // currentVersion will have to be updated to be the duplicated SubgraphVersion entity afterwards
  subgraph.versionCount = entity.versionCount
  subgraph.createdAt = entity.createdAt
  subgraph.updatedAt = entity.updatedAt
  subgraph.active = entity.active
  subgraph.signalledTokens = entity.signalledTokens
  subgraph.unsignalledTokens = entity.unsignalledTokens
  subgraph.currentSignalledTokens = entity.currentSignalledTokens
  subgraph.metadataHash = entity.metadataHash
  subgraph.ipfsMetadataHash = entity.ipfsMetadataHash
  subgraph.description = entity.description
  subgraph.image = entity.image
  subgraph.codeRepository = entity.codeRepository
  subgraph.website = entity.website
  subgraph.displayName = entity.displayName
  subgraph.linkedEntity = entity.id // this is the entity id, since for the entity, this value will be this particular entity.
  subgraph.entityVersion = newEntityVersion
  subgraph.save();
  return subgraph as Subgraph
}

export function duplicateOrUpdateSubgraphVersionWithNewID(entity: SubgraphVersion, newID: String, newEntityVersion: i32): SubgraphVersion {
  let version = SubgraphVersion.load(newID)
  if (version == null) {
    version = new SubgraphVersion(newID)
  }
  version.subgraphDeployment = entity.subgraphDeployment
  version.version = entity.version
  version.createdAt = entity.createdAt
  version.metadataHash = entity.metadataHash
  version.description = entity.description
  version.label = entity.label
  version.linkedEntity = entity.id
  version.entityVersion = newEntityVersion
  return version as SubgraphVersion
}

export function updateCurrentDeploymentLinks(
  oldDeployment: SubgraphDeployment | null,
  newDeployment: SubgraphDeployment | null,
  subgraph: Subgraph,
  deprecated: boolean = false,
): void {
log.debug("updateCurrentDeploymentLinks() - 1",[]);
  if (oldDeployment != null) {
    if (!deprecated) {
      let oldRelationEntity = CurrentSubgraphDeploymentRelation.load(
        subgraph.currentVersionRelationEntity!,
      )!
      oldRelationEntity.active = false
      oldRelationEntity.save()
    }

    oldDeployment.activeSubgraphCount = oldDeployment.activeSubgraphCount - 1
    if (deprecated) {
      oldDeployment.deprecatedSubgraphCount = oldDeployment.deprecatedSubgraphCount + 1
    }
    oldDeployment.save()
  }

log.debug("updateCurrentDeploymentLinks() - 2",[]);
  if (newDeployment != null) {
log.debug("newDeployment is not null.",[]);
    let newRelationID = newDeployment.id
      .concat('-')
      .concat(BigInt.fromI32(newDeployment.subgraphCount).toString())
    let newRelationEntity = new CurrentSubgraphDeploymentRelation(newRelationID)
    newRelationEntity.deployment = newDeployment.id
    newRelationEntity.subgraph = subgraph.id
    newRelationEntity.active = true
    newRelationEntity.save()

    newDeployment.subgraphCount = newDeployment.subgraphCount + 1
    newDeployment.activeSubgraphCount = newDeployment.activeSubgraphCount + 1
    newDeployment.save()

    subgraph.currentVersionRelationEntity = newRelationEntity.id
    subgraph.currentSignalledTokens = newDeployment.signalledTokens
    subgraph.save()
  }
}
/*
export function batchUpdateSubgraphSignalledTokens(deployment: SubgraphDeployment): void {
  for (let i = 0; i < deployment.subgraphCount; i++) {
    let id = deployment.id.concat('-').concat(BigInt.fromI32(i).toString())
    let relationEntity = CurrentSubgraphDeploymentRelation.load(id)!
    if (relationEntity.active) {
      let subgraphEntity = Subgraph.load(relationEntity.subgraph)!
      subgraphEntity.currentSignalledTokens = deployment.signalledTokens
      subgraphEntity.save()
    }
  }
}
*/
