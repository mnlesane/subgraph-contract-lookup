import { BigDecimal, BigInt, Bytes, ipfs, json, log } from '@graphprotocol/graph-ts'

import {
SubgraphPublished1,
SubgraphDeprecated1,
SubgraphMetadataUpdated1,
SubgraphVersionUpdated
} from './types/GNS/GNSStitched'

import {
Contract,
Subgraph,
SubgraphDeployment
} from './types/schema'

import {
  convertBigIntSubgraphIDToBase58,
  createOrLoadSubgraph,
  createOrLoadContract,
  addQm,
} from './helpers'

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

export function extractContractAddresses(ipfsData: String): Array<String> {
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
  for(let i = 1; i < kindSplit.length; i++) {
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
  }
  
  return res as Array<String>
}

export function processManifest(subgraph: Subgraph, subgraphDeploymentID: String): void {
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
      let assoc = subgraph.contract
      if(assoc.indexOf(address) == -1) {
        assoc.push(address)
        subgraph.contract = assoc
        subgraph.save()
      }
    }
  }
}

export function handleSubgraphPublished(event: SubgraphPublished1): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  processManifest(subgraph,subgraphDeploymentID)
}

// - event: SubgraphVersionUpdated(indexed uint256,indexed bytes32,bytes32)
//   handler: handleSubgraphVersionUpdated

// Might need to workaround this one, because of the ordering in subgraph creation scenario,
// we need to run this same code in SubgraphPublished (v2) too, and flag it so some of these executions
// don't create bugs (like double counting/creating versions)
export function handleSubgraphVersionUpdated(event: SubgraphVersionUpdated): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
  let subgraphDeploymentID = event.params.subgraphDeploymentID.toHexString()
  processManifest(subgraph,subgraphDeploymentID)
}

// - event: SubgraphDeprecated(indexed uint256,uint256)
//   handler: handleSubgraphDeprecatedV2

export function handleSubgraphDeprecated(event: SubgraphDeprecated1): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
  subgraph.active = false
  subgraph.save()
}

// - event: SubgraphMetadataUpdated(indexed uint256,bytes32)
//   handler: handleSubgraphMetadataUpdatedV2

export function handleSubgraphMetadataUpdated(event: SubgraphMetadataUpdated1): void {
  /*
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  */
}


