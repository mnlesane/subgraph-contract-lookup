import { BigInt, ByteArray, Address, Bytes, crypto, log, BigDecimal, ipfs, json, JSONValue, JSONValueKind } from '@graphprotocol/graph-ts'
import {
Contract,
Subgraph,
GraphAccount,
SubgraphDeployment,
SubgraphVersion,
Network,
ContractEvent
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

export function createOrLoadSubgraph(bigIntID: BigInt): Subgraph {
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)
  if(subgraph == null) {
    subgraph = new Subgraph(subgraphID)
    subgraph.active = true
    subgraph.owner = ""
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

//    deployment.subgraphCount = 0
//    deployment.activeSubgraphCount = 0
//    deployment.deprecatedSubgraphCount = 0
    deployment.save()
  }
  return deployment as SubgraphDeployment
}
