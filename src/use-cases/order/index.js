/*
  Use Case library for Orders.
  Orders are created by a webhook trigger from the P2WDB. Orders are a result of
  new data in P2WDB. They differ from Offers, which are generated by a local
  user.
  An Order is created to match a local Offer, but it's created indirectly, as
  a response to the webhook from the P2WDB. In this way, Orders generated from
  local Offers are no different than Orders generated by other peers.
*/

const OrderEntity = require('../../entities/order')

class OrderUseCases {
  constructor (localConfig = {}) {
    // console.log('User localConfig: ', localConfig)
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of adapters must be passed in when instantiating Order Use Cases library.'
      )
    }

    this.orderEntity = new OrderEntity()
    this.OrderModel = this.adapters.localdb.Order
  }

  // This method is called by the POST /order REST API controller, which is
  // triggered by a P2WDB webhook.
  async createOrder (orderObj) {
    try {
      console.log('Use Case createOrder(orderObj): ', orderObj)

      // console.log('this.adapters.bchjs: ', this.adapters.bchjs)

      // Verify that UTXO in order is unspent. If it is spent, then ignore the
      // order.
      const txid = orderObj.data.utxoTxid
      const vout = orderObj.data.utxoVout
      const utxoStatus = await this.adapters.bchjs.Blockchain.getTxOut(
        txid,
        vout
      )
      console.log('utxoStatus: ', utxoStatus)
      if (utxoStatus === null) return false

      // A new order gets a status of 'posted'
      orderObj.data.orderStatus = 'posted'

      const orderEntity = this.orderEntity.validate(orderObj)
      console.log('orderEntity: ', orderEntity)

      // Add order to the local database.
      const orderModel = new this.OrderModel(orderEntity)
      await orderModel.save()

      return true
    } catch (err) {
      console.error('Error in createOrder()')
      throw err
    }
  }

  async listOrders () {
    try {
      return this.OrderModel.find({})
    } catch (error) {
      console.error('Error in use-cases/order/listOrders()')
      throw error
    }
  }

  // Generate phase 2 of 3 - take the other side of an Order.
  // Based on this example:
  // https://github.com/Permissionless-Software-Foundation/bch-js-examples/blob/master/bch/applications/collaborate/sell-slp/e2e-exchange/step2-purchase-tx.js
  async takeOrder (orderCid) {
    try {
      console.log('orderCid: ', orderCid)

      // Get the Order information
      const orderInfo = await this.findOrderByHash(orderCid)
      console.log(`orderInfo: ${JSON.stringify(orderInfo, null, 2)}`)

      // Ensure the order is in a 'posted' state and not already 'taken'
      if (orderInfo.orderStatus && orderInfo.orderStatus !== 'posted') {
        throw new Error('order already taken')
      }

      // Verify that UTXO for sale is unspent. Abort if it's been spent.
      const txid = orderInfo.utxoTxid
      const vout = orderInfo.utxoVout
      const utxoStatus = await this.adapters.bchjs.Blockchain.getTxOut(
        txid,
        vout
      )
      console.log('utxoStatus: ', utxoStatus)
      if (utxoStatus === null) {
        console.log(`utxo txid: ${txid}, vout: ${vout}`)
        throw new Error('UTXO does not exist. Aborting.')
      }

      // Ensure the app has enough funds to complete the trade.
      await this.ensureFunds(orderInfo)

      // Get UTXOs.
      const utxos = this.adapters.wallet.bchWallet.utxos.utxoStore
      console.log(`utxos: ${JSON.stringify(utxos, null, 2)}`)

      // Create a partially signed transaction.
      // https://github.com/Permissionless-Software-Foundation/bch-js-examples/blob/master/bch/applications/collaborate/sell-slp/e2e-exchange/step2-purchase-tx.js#L59
      const partialTxHex = await this.adapters.wallet.generatePartialTx(orderInfo)

      return partialTxHex

    // return true
    } catch (err) {
      console.error('Error in use-cases/order/takeOrder()')
      throw err
    }
  }

  // Ensure that the wallet has enough BCH and tokens to complete the requested
  // trade. Will return true if it does. Will throw an error if it doesn't.
  async ensureFunds (orderEntity) {
    try {
      // console.log('this.adapters.wallet: ', this.adapters.wallet.bchWallet)
      // console.log(`walletInfo: ${JSON.stringify(this.adapters.wallet.bchWallet.walletInfo, null, 2)}`)

      // Ensure the app wallet has enough funds to write to the P2WDB.
      const wif = this.adapters.wallet.bchWallet.walletInfo.privateKey
      const canWriteToP2WDB = await this.adapters.p2wdb.checkForSufficientFunds(wif)
      if (!canWriteToP2WDB) throw new Error('App wallet does not have funds for writing to the P2WDB.')

      if (orderEntity.buyOrSell.includes('sell')) {
        // Sell Offer

        // Ensure the app wallet controlls enough BCH to pay for the tokens.
        const satsNeeded = orderEntity.numTokens * parseInt(orderEntity.rateInSats)
        const balance = await this.adapters.wallet.bchWallet.getBalance()
        console.log(`wallet balance: ${balance}, sats needed: ${satsNeeded}`)
        const SATS_MARGIN = 5000
        if (satsNeeded + SATS_MARGIN > balance) { throw new Error('App wallet does not control enough BCH to purchase the tokens.') }

      //
      } else {
        // Buy Offer
        throw new Error('Buy orders are not supported yet.')
      }

      return true
    } catch (err) {
      console.error('Error in ensureFunds()')
      throw err
    }
  }

  async findOrderByHash (p2wdbHash) {
    try {
      if (typeof p2wdbHash !== 'string' || !p2wdbHash) {
        throw new Error('p2wdbHash must be a string')
      }

      const order = await this.OrderModel.findOne({ p2wdbHash })

      if (!order) {
        throw new Error('order not found')
      }

      const orderObject = order.toObject()
      // return this.orderEntity.validateFromModel(orderObject)

      return orderObject
    } catch (err) {
      console.error('Error in findOrder(): ', err)
      throw err
    }
  }
}

module.exports = OrderUseCases
