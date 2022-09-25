const Transaction = require('../models/Transaction');
const User = require('../models/user');
const Product = require('../models/product');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const axios = require('axios');
const mongoose = require('mongoose');


const {PAYPAL_API,PAYPAL_API_CLIENT,PAYPAL_API_SECRET,} = require("../config");

const createOrder = async (req, res, next) => {
  try {
    const { cartItem } = req.body;
    const { id } = req.params;

    let itemsPaypal = [];
    for (let item of cartItem) {
      let itemObj = {
        id: item.product,
        name: item.title,
        description: item.title,
        sku: item.stock.stockTotal.toString(),
        unit_amount: {
          currency_code: 'USD',
          value: item.price.toString(),
        },
        tax: {
          currency_code: 'USD',
          value: '0',
        },
        quantity: item.quantity.toString(),
        category: 'PHYSICAL_GOODS',
      };
      itemsPaypal.push(itemObj);
    }
    let total_value = 0;
    for (let itemV of cartItem) {
      total_value = total_value + itemV.price * itemV.quantity;
    }
//Orden de compra que recibe Paypal

    const order = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: id,
          description: 'Arterest payment order',
          custom_id: 'CUST-Arterest',
          soft_descriptor: 'Arterest',
          amount: {
            currency_code: 'USD',
            value: total_value.toString(),
            breakdown: {
              item_total: {
                currency_code: 'USD',
                value: total_value.toString(),
              },
            },
          },
          items: itemsPaypal,
        },
      ],
      application_context: {
        brand_name: "Arterest",
        landing_page: "LOGIN",
        user_action: "PAY_NOW",
        return_url: 'http://localhost:3000',
        cancel_url: 'http://localhost:3000/cancel-payment',
      },
    };


    // format the body
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");

    // Generate an access token
    const {
      data: { access_token },
    } = await axios.post(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        auth: {
          username: PAYPAL_API_CLIENT,
          password: PAYPAL_API_SECRET,
        },
      }
    );

    console.log(access_token);

    // make a request
    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders`,
      order,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    console.log(response.data);
      //--guardar en user la orden compra
      let products = [];
      cartItem.map((el) =>
        products.push({
          publicationId: el.product,
          quantity: el.quantity,
        })
      );
    let user = await User.findByIdAndUpdate(id, {
      purchase_order: {
        products: products,
        link: response.data.links[1].href,
      },
    });

    res.json(response.data.links[1].href); //-- devuelvo el link de pago
  } catch (error) {
    console.log(error);
    next(error);
  }
};

const captureOrder = async (req, res, next) => {
  const { token } = req.query;

  try {
    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${token}/capture`,
      {},
      {
        auth: {
          username: PAYPAL_API_CLIENT,
          password: PAYPAL_API_SECRET,
        },
      }
    );

    const buyer_id = response.data.purchase_units[0].reference_id;

    const buyer = await User.findOne({ _id: buyer_id });
    const publications = buyer.purchase_order.products.map((e) => e);
    const pubs = [];

    for (let i = 0; i < publications.length; i++) {
      pubs.push(await Product.findById(publications[i].publicationId));
    }

    const purchase_units = pubs.map((e, i) => {
      return {
        
        quantity: publications[i].quantity,
        status: 'pending',
        product: pubs[i]._id,
      
      };
    });

    for (let i = 0; i < purchase_units.length; i++) {
      const newTransaction = await Transaction.create({
        transaction: purchase_units[i],
        buyer: buyer._id,
      });
      await User.findByIdAndUpdate(
        { _id: buyer._id },
        {
          $push: {
            buyHistory: [newTransaction._id],
          },
        },
        { new: true }
      );

      const publi = await Product.findOne({
        _id: purchase_units[i].publication,
      });
      publi.stock-=purchase_units[i].quantity;
      publi.save();
    }

    await User.updateOne(
      { _id: buyer_id },
      {
        purchase_order: {
          products: [],
          link: '',
        },
      }
    );
    
    const template = orderConfirmation({
      products: pubs.map((e, i) => {return {price: e.price, title: e.title, quantity: publications[i].quantity, img: e.img, origin: e.origin}}),
      address : buyer.address
    })

    sendEmail(buyer.email, 'Succesfully buy', template)

    res.status(200).json({ status: 'success', data: 'success' });
  } catch (error) {
    console.log(error);
    next(new AppError(error));
  }
};

const cancelPayment = (req, res) => {
  res.redirect("/");
};

module.exports = {cancelPayment, captureOrder, createOrder}