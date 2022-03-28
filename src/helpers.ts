import { BigInt, ByteArray, Address, Bytes, crypto, log, BigDecimal } from '@graphprotocol/graph-ts'
import {
Contract,
Subgraph,
SubgraphDeployment
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

export function createOrLoadSubgraph(bigIntID: BigInt): Subgraph {
  let subgraphID = convertBigIntSubgraphIDToBase58(bigIntID)
  let subgraph = Subgraph.load(subgraphID)
  if(subgraph == null) {
    subgraph = new Subgraph(subgraphID)
    subgraph.active = true
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

export function addQm(a: ByteArray): ByteArray {
  let out = new Uint8Array(34)
  out[0] = 0x12
  out[1] = 0x20
  for (let i = 0; i < 32; i++) {
    out[i + 2] = a[i]
  }
  return changetype<ByteArray>(out)
}
