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

const loginUrl = 'https://mon-espace.enercoop.fr/clients/sign_in'
const billUrl = 'https://mon-espace.enercoop.fr/factures'
moment.locale('fr')

const models = cozyClient.new.models
const { Qualification } = models.document

let rq = requestFactory({
  cheerio: true,
  json: false,
  debug: false,
  jar: true
})

module.exports = new BaseKonnector(start)

async function start(fields) {
  await authenticate(fields.login, fields.password)
  const bills = await parseBills()
  await saveBills(bills, fields.folderPath, {
    timeout: Date.now() + 60 * 1000,
    contentType: 'application/pdf',
    linkBankOperations: false,
    sourceAccount: this.accountId,
    sourceAccountIdentifier: fields.login,
    keys: ['vendorRef'],
    identifiers: ['enercoop'],
    fileIdAttributes: ['vendorRef']
  })
}

async function authenticate(login, password) {
  log('info', 'Starting authentication')
  // First request to get the authenticity_token
  const $loginPage = await rq(loginUrl)
  const hiddenToken = $loginPage('#new_ecppp_client > input').attr('value')
  const form = {
    authenticity_token: hiddenToken,
    'ecppp_client[email]': login,
    'ecppp_client[password]': password,
    'ecppp_client[remember_me]': 'true',
    commit: 'Se+connecter'
  }
  const options = {
    url: loginUrl,
    method: 'POST',
    form: form,
    resolveWithFullResponse: true,
    followAllRedirects: true,
    simple: false
  }
  const res = await rq(options)
  if (res.statusCode != 200) {
    throw new Error('LOGIN_FAILED')
  }
}

async function parseBills() {
  log('info', 'Starting bills parsing')
  let bills = []
  const $billPage = await rq(billUrl)
  const yearsHref = $billPage('div[class="dropdown dropdown-top"] a')
    .map((i, a) => $billPage(a).attr('href'))
    .toArray()

  for (const yearHref of yearsHref) {
    const $yearPage = await rq(`https://mon-espace.enercoop.fr${yearHref}`)
    const billsPerYear = $yearPage(
      'div[class="table-line table-line-collapse js-accordion-trigger"] > div[class="row"]'
    )
      .map((i, row) => $billPage(row).text())
      .toArray()
    for (const billInfos of billsPerYear) {
      let splitedInfos = billInfos.match(
        /([0-9]{4}) - (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)Réf. Facture([A-Z0-9-]*)Total TTC([0-9,]*)/
      )
      const year = splitedInfos[1]
      const month = moment.months().indexOf(splitedInfos[2]) + 1
      const date = moment(`${year}${month}`, 'YYYYMM')
      const vendorRef = splitedInfos[3]
      const amount = parseFloat(splitedInfos[4].replace(',', '.'))
      const currency = '€'
      const oneBill = {
        amount,
        currency,
        date: date.toDate(),
        vendor: 'Enercoop',
        vendorRef,
        filename: `${date.format('YYYYMM')}_enercoop.pdf`,
        fileurl: `https://mon-espace.enercoop.fr/invoice/${vendorRef}/pdf?invoice_type=factures`,
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
      }
      bills.push(oneBill)
    }
  }
  return bills
}
