/*
# TODO refactor - use classes/models to reduce redundant logic generating and updating entities

# Manual sanity test:
{
  subgraphs(first:5,orderBy:createdAt,orderDirection:desc) {
    id
    owner { id }
    active
    createdAt updatedAt
    displayName description image
    codeRepository website
    versionCount
    versions {
      id
      version
      createdAt
      metadataHash
      description
      subgraphDeployment {
        id
        ipfsHash
        createdAt
        originalName
#        manifest
        network {
          id
        }
#        schema
        schemaIpfsHash
        contract {
          id
          contractEvent {
            event
          }
        }
      }
    }
  }
}

{
  subgraphs(
    orderBy:currentSignalledTokens,
    orderDirection:desc,
    where:{entityVersion:2}) {
    id
    displayName
    signalledTokens
    currentSignalledTokens
  }
}


TODO V2:
* ENS integration
* Entity v1 vs v2 Reconciliation
* Signal
*/
import { BigDecimal, BigInt, Bytes, ipfs, json, log } from '@graphprotocol/graph-ts'

import {
SubgraphPublished1,
SubgraphDeprecated1,
SubgraphMetadataUpdated1,
SubgraphPublished,
SubgraphDeprecated,
SubgraphMetadataUpdated,
SubgraphVersionUpdated,
SubgraphUpgraded,
NSignalMinted,
NSignalBurned,
SignalMinted,
SignalBurned,
Transfer
} from './types/GNS/GNSStitched'

import {
Contract,
Subgraph,
SubgraphDeployment,
SubgraphVersion,
ContractEvent,
Network,
GraphAccount,
CurrentSubgraphDeploymentRelation
} from './types/schema'

import {
  convertBigIntSubgraphIDToBase58,
  createOrLoadSubgraph,
  createOrLoadSubgraphVersion,
  createOrLoadContract,
  createOrLoadGraphAccount,
  createOrLoadSubgraphDeployment,
  getSubgraphID,
  addQm,
  joinID,
  fetchSubgraphMetadata,
  fetchSubgraphVersionMetadata,
  fetchSubgraphDeploymentManifest,
  createOrLoadNetwork,
  createOrLoadContractEvent,
  duplicateOrUpdateSubgraphVersionWithNewID,
  duplicateOrUpdateSubgraphWithNewID,
  updateCurrentDeploymentLinks
} from './helpers'

/*
TODO
[V1.5]
* publisher/ENS

[V2]
* Signal and QF may be a following iteration, but slapping that into a UI seems pretty easy from there.
*/

// - event: SubgraphPublished(indexed uint256,indexed bytes32,uint32)
//   handler: handleSubgraphPublishedV2

export function stripQuotes(str: String): String {
  let res = ''
  let remove = ['\'','"',' ']
  for(let i = 0; i < str.length; i++) {
    if(!remove.includes(str[i])) res = res.concat(str[i])
  }
  return res as String
}

export function formatEvent(str: String): String {
  let res = ''
  let pass = ''
  // Strip Quotes - TODO breakout into function common to stripQuotes()
  let remove = ['\'','"']
  for(let i = 0; i < str.length; i++) {
    if(!remove.includes(str[i])) pass = pass.concat(str[i])
  }
  // Newline handling
  pass = pass.replaceAll('\r',' ')
  pass = pass.replaceAll('\n',' ')
  pass = pass.replaceAll('>-',' ')
  // Space handling
  log.debug("Finalizing cleanup of '{}'",[pass])
  let last = ' '
  for(let i = 0; i < pass.length; i++) {
    if(pass[i] == ' ' && last == ' ') {
      continue
    } else {
      res = res.concat(pass[i])
    }
    last = pass[i]
  }
  res = res.trim()
  
  return res as String
}

export function extractContractEvents(kind: String, contract: Contract): void {
  let eventHandlersSplit = kind.split("eventHandlers:",2)
  let eventHandlersStr = ''
  if(eventHandlersSplit.length >= 2) {
    eventHandlersStr = eventHandlersSplit[1]
  }
  log.debug("Splitting event from '{}'",[eventHandlersStr])
  let eventSplit = eventHandlersStr.split("- event:")
  for(let i = 1; i < eventSplit.length; i++) {
    log.debug("Isolating event from '{}'",[eventSplit[i]])
    let sanitizeSplit = eventSplit[i].split("handler:",2)
    let eventIso = formatEvent(sanitizeSplit[0])
    log.debug("Contract event isolated: '{}'",[eventIso])
    let contractEvent = createOrLoadContractEvent(contract.id,eventIso)
  }
}

export function extractContractAddresses(ipfsData: String): Array<String> {
  // Critical TODO: YAML parser.
  
  let res = new Array<String>(0)
  // Use split() until a suitable YAML parser is found.  Approach was used in graph-network-subgraph.
  log.debug("Splitting dataSources",[])
  let dataSourcesSplit = ipfsData.split('dataSources:\n',2)
  let dataSourcesStr = ''
  if(dataSourcesSplit.length >= 2) {
    dataSourcesStr = dataSourcesSplit[1];
  } else {
    // Problem
    return res as Array<String>
  }
  // Determine where 'dataSources:' ends, exclude everything thereafter.
  log.debug("Sanitizing dataSources split",[])
  let sanitizeSplit = dataSourcesStr.split('\n')
  let shouldDelete = false
  // Assumes 32 for space.
  dataSourcesStr = ''
  for(let i = 0; i < sanitizeSplit.length; i++) {
    if(sanitizeSplit[i].charAt(0) != ' ' || shouldDelete) {
      shouldDelete = true
    } else {
      dataSourcesStr = dataSourcesStr.concat(sanitizeSplit[i])
      if(i < sanitizeSplit.length - 1) {
        dataSourcesStr = dataSourcesStr.concat('\n')
      }
    }
  }
  
  // Extract
  log.debug("Splitting kind from '{}'",[dataSourcesStr])
  let kindSplit = dataSourcesStr.split('- kind:')

  let sourceStr = ''

  let addressStr = ''
  let addressIso = ''

//  let nameIso = ''
  
  for(let i = 1; i < kindSplit.length; i++) {
//    nameIso = ''
    addressIso = ''
        
    // Source Address
    log.debug("Splitting source from '{}'",[kindSplit[i]])
    let sourceSplit = kindSplit[i].split(' source:',2)
    if(sourceSplit.length < 2) continue
    else sourceStr = sourceSplit[1]
    
    log.debug("Splitting address from '{}'",[sourceStr])
    let addressSplit = sourceStr.split(' address:',2)
    if(addressSplit.length < 2) continue
    else addressStr = addressSplit[1]
    
    log.debug("Isolating address from '{}'",[addressStr])
    let addressStrSplit = addressStr.split('\n',2)
    if(addressStrSplit.length < 2) continue
    else addressIso = addressStrSplit[0]
    
    log.debug("Address '{}' extracted",[addressIso])
    res.push(stripQuotes(addressIso))

    // Let's isolate contract events while we're here.
    let contract = createOrLoadContract(stripQuotes(addressIso))
    log.debug("Splitting eventHandler from '{}'",[kindSplit[i]]);
    extractContractEvents(kindSplit[i],contract)
/*    
    if(nameIso.length > 0) {
      contract.name = nameIso
      contract.save()
      
    }
*/
  }
  
  return res as Array<String>
}

export function processManifest(subgraph: Subgraph, deployment: SubgraphDeployment): void {
  let subgraphDeploymentID = deployment.id
  let subgraphID = subgraph.id
  let prefix = '1220'
  let ipfsHash = Bytes.fromHexString(prefix.concat(subgraphDeploymentID.slice(2))).toBase58()

  log.debug("Checking IPFS for hash '{}'",[ipfsHash])
  
  let ipfsData = ipfs.cat(ipfsHash)
  
  if(ipfsData !== null) {
    let contractAddresses = extractContractAddresses(ipfsData.toString())
    let address = ''
    for(let i = 0; i < contractAddresses.length; i++) {
      address = contractAddresses[i]
      log.debug("Associating address '{}'",[address])
      let contract = createOrLoadContract(address)
      let assoc = deployment.contract
      if(assoc.indexOf(address) == -1) {
        assoc.push(address)
        deployment.contract = assoc
        deployment.save()
      }
    }
  }
}

/*
ProcessManifest calls:
- handleSubgraphPublishedV2
- handleSubgraphPublished
- handleSubgraphVersionUpdated
*/

export function handleSubgraphPublishedV2(event: SubgraphPublished1): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID,event.block.timestamp)
  
  let graphAccount = createOrLoadGraphAccount(event.transaction.from)
  subgraph.owner = graphAccount.id

  if(event.block.timestamp.toI32() > subgraph.updatedAt) {
    subgraph.updatedAt = event.block.timestamp.toI32()
  }
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  
  let oldVersionID = subgraph.currentVersion

  let versionNumber = subgraph.versionCount
  let versionID = joinID([subgraph.id, subgraph.versionCount.toString()])
  subgraph.currentVersion = versionID
  subgraph.versionCount = subgraph.versionCount.plus(BigInt.fromI32(1))
  subgraph.updatedAt = event.block.timestamp.toI32()

  subgraph.save()


  // Create subgraph deployment, if needed. Can happen if the deployment has never been staked on
  let deployment = createOrLoadSubgraphDeployment(subgraphDeploymentID)
  deployment.createdAt = event.block.timestamp.toI32()
  deployment.subgraph = subgraph.id
  deployment.save()

  // Create subgraph version
  let subgraphVersion = createOrLoadSubgraphVersion(subgraph,deployment)
  subgraphVersion.createdAt = event.block.timestamp.toI32()
  subgraphVersion.entityVersion = 2
  subgraphVersion.save()

  processManifest(subgraph,deployment)

  let oldDeployment: SubgraphDeployment | null = null
  if (oldVersionID != null) {
    let oldVersion = SubgraphVersion.load(oldVersionID!)!
    oldDeployment = SubgraphDeployment.load(oldVersion.subgraphDeployment)!
  }
  // create deployment - named subgraph relationship, and update the old one
  updateCurrentDeploymentLinks(oldDeployment, deployment, subgraph as Subgraph)
}

export function handleSubgraphPublished(event: SubgraphPublished): void {
  let oldID = joinID([
    event.params.graphAccount.toHexString(),
    event.params.subgraphNumber.toString(),
  ])
  
  let subgraphID = getSubgraphID(event.params.graphAccount, event.params.subgraphNumber)
  let subgraph = createOrLoadSubgraph(subgraphID,event.block.timestamp)
  let oldVersionID = subgraph.currentVersion
  
  let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, oldID, 1)
  subgraph.linkedEntity = subgraphDuplicate.id

  let graphAccount = createOrLoadGraphAccount(event.params.graphAccount)
  subgraph.owner = graphAccount.id

  subgraph.createdAt = event.block.timestamp.toI32()
  if(event.block.timestamp.toI32() > subgraph.updatedAt) {
    subgraph.updatedAt = event.block.timestamp.toI32()
  }
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  
  
  // Create subgraph deployment, if needed. Can happen if the deployment has never been staked on
  let deployment = createOrLoadSubgraphDeployment(subgraphDeploymentID)
  deployment.createdAt = event.block.timestamp.toI32()
  deployment.subgraph = subgraph.id
  deployment.save()

  let versionNumber = subgraph.versionCount
  let versionIDOld = joinID([oldID, subgraph.versionCount.toString()])
  let versionIDNew = joinID([subgraph.id, subgraph.versionCount.toString()])
  
  subgraph.currentVersion = versionIDNew
  subgraphDuplicate.currentVersion = versionIDOld
  subgraph.versionCount = versionNumber.plus(BigInt.fromI32(1))
  
  // Create subgraph version
  let subgraphVersion = createOrLoadSubgraphVersion(subgraph,deployment)
  subgraph.updatedAt = event.block.timestamp.toI32()
  let hexHash = changetype<Bytes>(addQm(event.params.versionMetadata))
  let base58Hash = hexHash.toBase58()
  subgraphVersion.metadataHash = event.params.versionMetadata
  subgraphVersion = fetchSubgraphVersionMetadata(subgraphVersion, base58Hash)
  subgraphVersion.entityVersion = 2
  subgraphVersion.save()
  subgraph.save()

  let subgraphVersionDuplicate = duplicateOrUpdateSubgraphVersionWithNewID(
    subgraphVersion,
    versionIDOld,
    1,
  )
  subgraphVersionDuplicate.subgraph = subgraphDuplicate.id
  subgraphVersion.linkedEntity = subgraphVersionDuplicate.id
  subgraphVersionDuplicate.save()
  subgraphVersion.save()

  let oldDeployment: SubgraphDeployment | null = null
  if (oldVersionID != null) {
    let oldVersion = SubgraphVersion.load(oldVersionID!)!
    oldDeployment = SubgraphDeployment.load(oldVersion.subgraphDeployment)!
  }
  // create deployment - named subgraph relationship, and update the old one
  updateCurrentDeploymentLinks(oldDeployment, deployment, subgraphDuplicate as Subgraph)
  updateCurrentDeploymentLinks(oldDeployment, deployment, subgraph as Subgraph)
  
  processManifest(subgraph,deployment)  
}

// - event: SubgraphDeprecated(indexed uint256,uint256)
//   handler: handleSubgraphDeprecatedV2

export function handleSubgraphDeprecatedV2(event: SubgraphDeprecated1): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID,event.block.timestamp)
  subgraph.active = false

  let subgraphDuplicate: Subgraph | null = null
  if (subgraph.linkedEntity != null) {
    subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, subgraph.linkedEntity!, 1)
    subgraphDuplicate.save()
  }

  let version = SubgraphVersion.load(subgraph.currentVersion!)
  if (version != null) {
    let deployment = SubgraphDeployment.load(version.subgraphDeployment)
    updateCurrentDeploymentLinks(deployment, null, subgraph as Subgraph, true)
    if (subgraphDuplicate != null) {
      updateCurrentDeploymentLinks(deployment, null, subgraphDuplicate as Subgraph, true)
    }
  }
  
  subgraph.save()
}

export function handleSubgraphDeprecated(event: SubgraphDeprecated): void {
  let bigIntID = getSubgraphID(event.params.graphAccount, event.params.subgraphNumber)
  let subgraph = createOrLoadSubgraph(bigIntID,event.block.timestamp)
  let graphAccount = createOrLoadGraphAccount(event.params.graphAccount)
  subgraph.owner = graphAccount.id
  subgraph.active = false
  subgraph.save()
}

// - event: SubgraphVersionUpdated(indexed uint256,indexed bytes32,bytes32)
//   handler: handleSubgraphVersionUpdated

// Might need to workaround this one, because of the ordering in subgraph creation scenario,
// we need to run this same code in SubgraphPublished (v2) too, and flag it so some of these executions
// don't create bugs (like double counting/creating versions)
export function handleSubgraphVersionUpdated(event: SubgraphVersionUpdated): void {
  let versionID: string
  let versionNumber: BigInt

  let bigIntID = event.params.subgraphID
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!

  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  if(event.block.timestamp.toI32() > subgraph.updatedAt) {
    subgraph.updatedAt = event.block.timestamp.toI32()
  }

  if (subgraph.initializing) {
    subgraph.initializing = false
    subgraph.save()

    // Update already initialized subgraph version
    versionID = joinID([subgraph.id, subgraph.versionCount.minus(BigInt.fromI32(1)).toString()])
    let subgraphVersion = SubgraphVersion.load(versionID)!
    let hexHash = changetype<Bytes>(addQm(event.params.versionMetadata))
    let base58Hash = hexHash.toBase58()
    subgraphVersion.metadataHash = event.params.versionMetadata
    subgraphVersion = fetchSubgraphVersionMetadata(subgraphVersion, base58Hash)
    subgraphVersion.save()
  } else {
    let oldVersionID = subgraph.currentVersion

    versionNumber = subgraph.versionCount
    versionID = joinID([subgraph.id, subgraph.versionCount.toString()])
    subgraph.currentVersion = versionID
    subgraph.versionCount = subgraph.versionCount.plus(BigInt.fromI32(1))
    subgraph.updatedAt = event.block.timestamp.toI32()
    subgraph.save()

    // Create subgraph deployment, if needed. Can happen if the deployment has never been staked on
    let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
    let deployment = createOrLoadSubgraphDeployment(subgraphDeploymentID)
    deployment.createdAt = event.block.timestamp.toI32()

    // Create subgraph version
    let subgraphVersion = new SubgraphVersion(versionID)
    subgraphVersion.entityVersion = 2
    subgraphVersion.subgraph = subgraph.id
    subgraphVersion.subgraphDeployment = subgraphDeploymentID
    subgraphVersion.version = versionNumber.toI32()
    subgraphVersion.createdAt = event.block.timestamp.toI32()
    let hexHash = changetype<Bytes>(addQm(event.params.versionMetadata))
    let base58Hash = hexHash.toBase58()
    subgraphVersion.metadataHash = event.params.versionMetadata
    subgraphVersion = fetchSubgraphVersionMetadata(subgraphVersion, base58Hash)

    let oldDeployment: SubgraphDeployment | null = null
    if (oldVersionID != null) {
      let oldVersion = SubgraphVersion.load(oldVersionID!)!
      oldDeployment = SubgraphDeployment.load(oldVersion.subgraphDeployment)!
    }
    // create deployment - named subgraph relationship, and update the old one
    updateCurrentDeploymentLinks(oldDeployment, deployment, subgraph as Subgraph)

    if (subgraph.linkedEntity != null) {
      let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(
        subgraph,
        subgraph.linkedEntity!,
        1,
      )
      let duplicateVersionID = joinID([subgraphDuplicate.id, versionNumber.toString()])
      subgraphDuplicate.currentVersion = duplicateVersionID
      subgraphDuplicate.save()

      let subgraphVersionDuplicate = duplicateOrUpdateSubgraphVersionWithNewID(
        subgraphVersion,
        duplicateVersionID,
        1,
      )
      subgraphVersionDuplicate.subgraph = subgraphDuplicate.id
      subgraphVersion.linkedEntity = subgraphVersionDuplicate.id
      subgraphVersionDuplicate.save()

      updateCurrentDeploymentLinks(oldDeployment, deployment, subgraphDuplicate as Subgraph)
    }
    subgraphVersion.save()
    processManifest(subgraph,deployment)
  }
  subgraph.save()
}

// - event: SubgraphMetadataUpdated(indexed uint256,bytes32)
//   handler: handleSubgraphMetadataUpdatedV2

export function handleSubgraphMetadataUpdatedV2(event: SubgraphMetadataUpdated1): void {
  let bigIntID = event.params.subgraphID
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!

  let hexHash = changetype<Bytes>(addQm(event.params.subgraphMetadata))
  let base58Hash = hexHash.toBase58()

  subgraph.metadataHash = event.params.subgraphMetadata
  subgraph.ipfsMetadataHash = addQm(subgraph.metadataHash).toBase58()
  subgraph = fetchSubgraphMetadata(subgraph, base58Hash)
  subgraph.updatedAt = event.block.timestamp.toI32()

  if (subgraph.linkedEntity != null) {
    let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, subgraph.linkedEntity!, 1)
    subgraphDuplicate.save()
  }
  
  subgraph.save()

  // Add the original subgraph name to the subgraph deployment
  // This is a temporary solution until we can filter on nested queries
  let subgraphVersion = SubgraphVersion.load(subgraph.currentVersion!)!
  let subgraphDeployment = SubgraphDeployment.load(subgraphVersion.subgraphDeployment)!
  // Not super robust, someone could deploy blank, then point a subgraph to here
  // It is more appropriate to say this is the first name 'claimed' for the deployment
  if (subgraphDeployment.originalName == null) {
    subgraphDeployment.originalName = subgraph.displayName
    subgraphDeployment.save()
  }
}

export function handleSubgraphMetadataUpdated(event: SubgraphMetadataUpdated): void {
  let oldID = joinID([
    event.params.graphAccount.toHexString(),
    event.params.subgraphNumber.toString(),
  ])
  let subgraphID = getSubgraphID(event.params.graphAccount, event.params.subgraphNumber)

  // Create subgraph
  let subgraph = createOrLoadSubgraph(subgraphID,event.block.timestamp)
  
  let graphAccount = createOrLoadGraphAccount(event.params.graphAccount)
  subgraph.owner = graphAccount.id

  let hexHash = changetype<Bytes>(addQm(event.params.subgraphMetadata))
  let base58Hash = hexHash.toBase58()

  subgraph.metadataHash = event.params.subgraphMetadata
  subgraph.ipfsMetadataHash = addQm(subgraph.metadataHash).toBase58()
  subgraph = fetchSubgraphMetadata(subgraph, base58Hash)
  subgraph.updatedAt = event.block.timestamp.toI32()
  subgraph.save()

  let subgraphVersion = SubgraphVersion.load(subgraph.currentVersion!)!
  let subgraphDeployment = SubgraphDeployment.load(subgraphVersion.subgraphDeployment)!

  if (subgraphDeployment.originalName == null) {
    subgraphDeployment.originalName = subgraph.displayName
    subgraphDeployment.save()
  }

  let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, oldID, 1)
  subgraphDuplicate.save()
}


export function handleSubgraphUpgraded(event: SubgraphUpgraded): void {
/*
  let bigIntID = event.params.subgraphID
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  processManifest(subgraph,subgraphDeploymentID)
*/
}

// - event: Transfer(indexed address,indexed address,indexed uint256)
//   handler: handleTransfer

export function handleTransfer(event: Transfer): void {
  let newOwner = createOrLoadGraphAccount(event.params.to)

  // Update subgraph v2
  let subgraph = createOrLoadSubgraph(
    event.params.tokenId,event.block.timestamp
  )
  subgraph.updatedAt = event.block.timestamp.toI32()
  subgraph.owner = newOwner.id
  
  if (subgraph.linkedEntity != null) {
    let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, subgraph.linkedEntity!, 1)
    subgraphDuplicate.save()
  }
  
  subgraph.save()
}

export function handleNSignalMinted(event: NSignalMinted): void {
  let oldID = joinID([
    event.params.graphAccount.toHexString(),
    event.params.subgraphNumber.toString(),
  ])
  
  let bigIntID = getSubgraphID(event.params.graphAccount, event.params.subgraphNumber)
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!
  subgraph.signalledTokens = subgraph.signalledTokens.plus(event.params.tokensDeposited)
  subgraph.currentSignalledTokens = subgraph.currentSignalledTokens.plus(event.params.tokensDeposited)

  let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, oldID, 1)
  subgraphDuplicate.save()
  
  subgraph.save()
}

export function handleNSignalBurned(event: NSignalBurned): void {
  let oldID = joinID([
    event.params.graphAccount.toHexString(),
    event.params.subgraphNumber.toString(),
  ])
  let bigIntID = getSubgraphID(event.params.graphAccount, event.params.subgraphNumber)
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!
  subgraph.unsignalledTokens = subgraph.unsignalledTokens.plus(event.params.tokensReceived)
  subgraph.currentSignalledTokens = subgraph.currentSignalledTokens.minus(event.params.tokensReceived)

  let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, oldID, 1)
  subgraphDuplicate.save()
  
  subgraph.save()
}

export function handleNSignalMintedV2(event: SignalMinted): void {
  let bigIntID = event.params.subgraphID
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!
  subgraph.signalledTokens = subgraph.signalledTokens.plus(event.params.tokensDeposited)
  subgraph.currentSignalledTokens = subgraph.currentSignalledTokens.plus(event.params.tokensDeposited)

  if (subgraph.linkedEntity != null) {
    let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, subgraph.linkedEntity!, 1)
    subgraphDuplicate.save()
  }

  subgraph.save()

}

export function handleNSignalBurnedV2(event: SignalBurned): void {
  let bigIntID = event.params.subgraphID
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)!
  subgraph.unsignalledTokens = subgraph.unsignalledTokens.plus(event.params.tokensReceived)
  subgraph.currentSignalledTokens = subgraph.currentSignalledTokens.minus(event.params.tokensReceived)
  
  if (subgraph.linkedEntity != null) {
    let subgraphDuplicate = duplicateOrUpdateSubgraphWithNewID(subgraph, subgraph.linkedEntity!, 1)
    subgraphDuplicate.save()
  }
  
  subgraph.save()
}

