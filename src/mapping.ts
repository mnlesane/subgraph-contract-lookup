import { BigDecimal, BigInt, Bytes, ipfs, json } from '@graphprotocol/graph-ts'

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

export function handleSubgraphPublished(event: SubgraphPublished1): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
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
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  
  let ipfsMetadataHash = changetype<string>(addQm(event.params.subgraphMetadata))
  let ipfsData = ipfs.cat(ipfsMetadataHash)
  if(ipfsData !== null) {
    let tryData = json.try_fromBytes(ipfsData as Bytes)
    if (tryData.isOk) {
      let data = tryData.value.toObject()
      let dataSources = data.get("dataSources")
      if(dataSources !== null) {
        let dataSourcesArray = dataSources.toArray()
        for(let i = 0; i < dataSourcesArray.length; i++) {
          let dataSource = dataSourcesArray[i]
          let dataSourceObject = dataSource.toObject()
          let source = dataSourceObject.get("source")
          if(source !== null) {
            let sourceObject = source.toObject()
            let address = sourceObject.get("address")
            if(address !== null) {
              let contract = createOrLoadContract(address.toString())
              let assoc = contract.subgraph
              assoc.push(subgraphID)
              contract.subgraph = assoc
              contract.save()
            }
          }
        }
      }
    } else {
      //
    }
  }
}

// - event: SubgraphVersionUpdated(indexed uint256,indexed bytes32,bytes32)
//   handler: handleSubgraphVersionUpdated

// Might need to workaround this one, because of the ordering in subgraph creation scenario,
// we need to run this same code in SubgraphPublished (v2) too, and flag it so some of these executions
// don't create bugs (like double counting/creating versions)

export function handleSubgraphVersionUpdated(event: SubgraphVersionUpdated): void {
  let bigIntID = event.params.subgraphID
  let subgraph = createOrLoadSubgraph(bigIntID)
}
