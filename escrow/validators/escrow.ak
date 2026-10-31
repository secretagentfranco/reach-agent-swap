use aiken/collection/list
use aiken/interval
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/assets.{Assets}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}

pub type Order {
  maker: Address,
  offer_policy: ByteArray,
  offer_name: ByteArray,
  ask_policy: ByteArray,
  ask_name: ByteArray,
  remaining: Int,
  price_numerator: Int,
  price_denominator: Int,
  expires_at: Int,
  order_id: ByteArray,
}

pub type Action {
  Fill { taker: Address, amount: Int }
  Cancel
}

fn pays(output: Output, recipient: Address, value: Assets) -> Bool {
  output.address == recipient && list.all(assets.flatten(value), fn(asset) {
    let (policy, name, quantity) = asset
    assets.quantity_of(output.value, policy, name) >= quantity
  })
}

validator escrow {
  spend(datum: Option<Order>, action: Action, own_ref: OutputReference, tx: Transaction) {
    expect Some(order) = datum
    expect Some(own) = list.find(tx.inputs, fn(input) { input.output_reference == own_ref })
    expect VerificationKey(maker_key) = order.maker.payment_credential
    let script_inputs = list.filter(tx.inputs, fn(input) {
      input.output.address.payment_credential == own.output.address.payment_credential
    })
    expect list.length(script_inputs) == 1
    when action is {
      Cancel -> and {
        list.has(tx.extra_signatories, maker_key),
        list.any(tx.outputs, fn(output) { pays(output, order.maker, own.output.value) }),
      }
      Fill { taker, amount } -> {
        expect VerificationKey(taker_key) = taker.payment_credential
        expect and {
          amount > 0,
          amount <= order.remaining,
          order.price_numerator > 0,
          order.price_denominator > 0,
          order.offer_policy != order.ask_policy || order.offer_name != order.ask_name,
          assets.quantity_of(own.output.value, order.offer_policy, order.offer_name) >= order.remaining,
          taker_key != maker_key,
          list.has(tx.extra_signatories, taker_key),
          interval.is_entirely_before(tx.validity_range, order.expires_at),
        }
        let payment = (amount * order.price_numerator + order.price_denominator - 1) / order.price_denominator
        let rest_value = assets.add(own.output.value, order.offer_policy, order.offer_name, -amount)
        let maker_value = if amount == order.remaining {
          assets.add(rest_value, order.ask_policy, order.ask_name, payment)
        } else {
          assets.from_asset(order.ask_policy, order.ask_name, payment)
        }
        let next_order = Order { ..order, remaining: order.remaining - amount }
        let next_data: Data = next_order
        let continuing = list.filter(tx.outputs, fn(output) {
          output.address.payment_credential == own.output.address.payment_credential
        })
        let continuation_valid = if amount == order.remaining {
          list.is_empty(continuing)
        } else {
          expect [next] = continuing
          and {
            next.address == own.output.address,
            next.value == rest_value,
            next.datum == InlineDatum(next_data),
          }
        }
        and {
          list.any(tx.outputs, fn(output) { pays(output, order.maker, maker_value) }),
          list.any(tx.outputs, fn(output) {
            pays(output, taker, assets.from_asset(order.offer_policy, order.offer_name, amount))
          }),
          continuation_valid,
        }
      }
    }
  }
  else(_) { fail }
}
