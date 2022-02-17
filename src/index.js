// Forces entry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://0c261e83b5164ba59aac696adce7f2aa@errors.cozycloud.cc/26'

const moment = require('moment')
const {
  log,
  BaseKonnector,
  saveBills,
  requestFactory,
  cozyClient
} = require('cozy-konnector-libs')

const baseUrl = 'https://espace-client.enercoop.fr'
const loginUrl = baseUrl + '/login'
const billUrl = baseUrl + '/mon-espace/factures/'
moment.locale('fr')

const models = cozyClient.new.models
const { Qualification } = models.document

let rq = requestFactory({
  cheerio: true,
  json: false,
  debug: false,
  jar: true
})

module.exports = new BaseKonnector(function fetch(fields) {
  return logIn(fields)
    .then(parsePage)
    .then(entries =>
      saveBills(entries, fields.folderPath, {
        timeout: Date.now() + 60 * 1000,
        contentType: 'application/pdf',
        linkBankOperations: false,
        sourceAccount: this.accountId,
        sourceAccountIdentifier: fields.login
      })
    )
})

// Procedure to login to Enercoop website.
function logIn(fields) {
  const form = {
    email: fields.login,
    password: fields.password
  }

  const options = {
    url: loginUrl,
    method: 'POST',
    form: form,
    resolveWithFullResponse: true,
    followAllRedirects: true,
    simple: false
  }

  return rq(options).then(res => {
    const isNot200 = res.statusCode !== 200
    if (isNot200) {
      log('info', 'Authentification error')
      throw new Error('LOGIN_FAILED')
    }

    const url = `${billUrl}`
    return rq(url).catch(err => {
      log('error', err)
      throw new Error('LOGIN_FAILED')
    })
  })
}

// Parse the fetched DOM page to extract bill data.
function parsePage($) {
  const bills = []
  $('.invoice-line').each(function() {
    // one bill per line = a <li> with 'invoice-id' data-attr
    // let billId = $(this).data('invoice-id')

    let amount = $(this)
      .find('.amount')
      .text()
    amount = amount.replace('€', '')
    amount = amount.replace(',', '.').trim()
    amount = parseFloat(amount)

    // gets pdf download URL
    let pdfUrl = $(this)
      .find('a > i')
      .data('url')

    // <French month>-YYYY format (Décembre - 2017)
    let billDate = $(this)
      .find('.invoiceDate')
      .text()
      .trim()
    let monthAndYear = billDate.split('-')
    let billYear = monthAndYear[0].trim()
    let billMonth = monthAndYear[1].trim()

    billMonth = moment.months().indexOf(billMonth.toLowerCase()) + 1
    billMonth = billMonth < 10 ? '0' + billMonth : billMonth
    let date = moment(billYear + billMonth, 'YYYYMM')

    let bill = {
      amount,
      date: date.toDate(),
      vendor: 'Enercoop'
    }

    if (pdfUrl) {
      Object.assign(bill, {
        filename: `${date.format('YYYYMM')}_enercoop.pdf`,
        fileurl: baseUrl + pdfUrl,
        fileAttributes: {
          metadata: {
            contentAuthor: 'enercoop.fr',
            issueDate: date.toDate(),
            datetime: new Date(),
            datetimeLabel: `issueDate`,
            isSubscription: true,
            carbonCopy: true,
            qualification: Qualification.getByLabel('energy_invoice')
          }
        }
      })
    }

    bills.push(bill)
  })

  return bills
}
