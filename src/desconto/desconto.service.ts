import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import fs from 'fs';
import PdfPrinter from 'pdfmake';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import { restaurar } from 'src/common/cripto';
import { Empresa } from 'src/contrato/contrato';
import { CriptoService } from 'src/cripto/cripto.service';
import { getOrCreateKnexInstance } from 'src/database/knexCache';
import { SiteSuccessDatabaseService } from 'src/database/site-success-database.service';
import { calcularDiferencaDesconto } from 'src/helper/helper';
import { DescontoTDO, GeneratedData, GenerateIdDataByArray } from 'src/models/types';
import { PriceService } from 'src/price/price.service';
import { UtilService } from './util.service';
const percent = require("percent-value")




const ABNT_5891_1977 = require('arredondamentoabnt').ABNT_5891_1977
const abnt = new ABNT_5891_1977(2);


@Injectable()
export class DescontoService {
	constructor(private readonly siteSuccessDatabase: SiteSuccessDatabaseService,
		private readonly cripto: CriptoService,
		private priceService: PriceService,
		private utilService: UtilService
	) { }


	gerar = () => {
		const fonts = {
			Helvetica: {
				normal: 'Helvetica',
				bold: 'Helvetica-Bold',
				italics: 'Helvetica-Oblique',
				bolditalics: 'Helvetica-BoldOblique'
			}
		};

		const printer = new PdfPrinter(fonts)

		const docDefinitions: TDocumentDefinitions = {
			defaultStyle: { font: "Helvetica" },
			content: [
				{ text: "Meu primeiro relatório" }
			],
		}

		const pdfDoc = printer.createPdfKitDocument(docDefinitions);
		pdfDoc.pipe(fs.createWriteStream("Relatório.pdf"))
		pdfDoc.end()

		return { ok: 200 }

	}
	async getDados() {
		const knex = await this.siteSuccessDatabase.getConnection();
		const registro = await knex('cfgw').select();
		return registro;
	}

	async getDadosConexaoCache(contrato: string) {

		const knext = await this.siteSuccessDatabase.getConnection()

		const registro = await knext('cfgw')
			.select([
				{
					servidor: knext.raw('hex(serbco)'),
					banco: knext.raw('hex(bcodad)'),
					usuario: knext.raw('hex(usebco)'),
					senha: knext.raw('hex( pasbco)'),
					porta: knext.raw('hex(porbco)'),
					dataSincronismo: knext.raw('hex(datsinbco)'),
				},
			])
			.where('tposer', 'SDC')
			.andWhere(knext.raw('hex(bcodad)'), '=', contrato)
			.andWhere('sr_deleted', '<>', 'T')
			.first() as any;

		if (!registro) return;

		const registroRestaurado = {
			servidor: (await this.cripto.decriptar(registro.servidor)).trimEnd(),
			banco: (await this.cripto.decriptar(registro.banco)).trimEnd(),
			usuario: (await this.cripto.decriptar(registro.usuario)).trimEnd(),
			senha: (await this.cripto.decriptar(registro.senha)).trimEnd(),
			porta: (await this.cripto.decriptar(registro.porta)).trimEnd(),
			servidorHex: registro.servidor,
			bcohex: registro.banco,
			dataSincronismo: (
				await this.cripto.decriptar(registro.dataSincronismo)
			).trimEnd(),
		}

		return registroRestaurado
	}


	async getConexaoCliente(contrato: string) {
		//const contratoDescirptogrado = await this.cripto.publicDecript(contrato, "Success2021");
		//const { codigo } = await this.verificaContrato(contratoDescirptogrado)
		const dadosConexao = await this.getDadosConexaoCache(contrato)
		if (!dadosConexao)
			throw new NotFoundException(
				'Dados de conexão com o banco de dados do cliente não encontrados!'
			)

		const knex = await getOrCreateKnexInstance(dadosConexao)

		return knex
	}

	async getEmpresas(contrato: string, codigoEmpresa: string) {
		const knex = await this.getConexaoCliente(contrato)

		const empresas = await knex('pe' + codigoEmpresa).select([
			'codigo',
			'razao',
			'empresa',
			'cgc',
		])

		const parsedEmpresas: Empresa[] = empresas.map(empresa => ({
			codigo: empresa.codigo,
			razao: restaurar(empresa.razao),
			empresa: restaurar(empresa.empresa),
			cnpj: empresa.cgc,
			cidade: empresa.cidade
		}))

		return parsedEmpresas
	}

	async adicionarDescontoDev(descontoTDO: DescontoTDO) {
		console.log(descontoTDO)
		//cria a conexão 
		const knex1 = await this.getConexaoCliente(descontoTDO.dados.contratoEmpresa)
		//descriptografia dos dados codigoEmpresa, fornecedor etc. Dados esses recebidos por parametro criptografados.
		const empresa = await this.cripto.publicDecript(descontoTDO.dados.codigoEmpresa, "Success2021")
		const fornecedor = await this.cripto.publicDecript(descontoTDO.dados.fornecedor, "Success2021")
		const codigoCotacao = await this.cripto.publicDecript(descontoTDO.dados.codigo, "Success2021")

		/*buscar no banco e somar o valor de custo de todos os itens para descobrir quanto
			 em percentual é o valor do desconto que está sendo passado */
		const data = await this.priceService.getItensCotacao(descontoTDO.dados.codigo, descontoTDO.dados.fornecedor, descontoTDO.dados.contratoEmpresa, descontoTDO.dados.codigoEmpresa)
		console.log(data)
		const itensCotacao: any[] = data.itens;


		const itensTyped = calcularDiferencaDesconto(itensCotacao, descontoTDO)



		return await knex1.transaction(trx => {

			const queries = [];

			itensTyped.forEach((item) => {
				const query = knex1('deic' + empresa).update({
					descot6: item.desconto,
					despesa6: item.frete,
					forpag6: descontoTDO?.formaPagamento,
				}).where('forneced6', fornecedor).andWhere('codigo6', codigoCotacao).andWhere("item6", item.item)
					.transacting(trx).debug(false)
				queries.push(query)
			});

			Promise.all(queries)
				.then(trx.commit)
				.catch(trx.rollback)


		}).then((resposta: number[]) => {

			let total = 0;
			resposta.forEach((code: number) => {
				total += code

			});
			if (total !== itensCotacao.length) {
				return {
					"statusCode": HttpStatus.BAD_REQUEST,
					"message": "Ocorreu um erro ao atualizar os itens",
				}
			}

			return {
				"statusCode": 201,
				"message": "Itens atualizados",
			}
		}).catch(error => {
			console.log("error", error)
			return {
				"statusCode": HttpStatus.BAD_REQUEST,
				"message": "Ocorreu um erro ao atualizar os itens",
			}
		})

	}

	async teste(body: any) {

		const desconto = body.percentual;

		const dados = [
			{
				valor: 3,
				desconto: 0
			},
			{
				valor: 3,
				desconto: 0
			},
			{
				valor: 3,
				desconto: 0
			},
			{
				valor: 3,
				desconto: 0
			}
		]
		const valorTotalItens = await this.utilService.calcularTotalItens(dados)
		const percentual = abnt.arredonda(percent(desconto).of(valorTotalItens));
		// console.log("valor total itens", valorTotalItens)
		// console.log(desconto, "é", percentual, "% de", valorTotalItens)

		let value = Number.parseFloat(abnt.arredonda(percent(percentual).from(valorTotalItens)).toFixed(2));
		//value = desconto - value;
		value += value - desconto;

		//value += resto;
		// console.log("processo inverso", value)
		// console.log(desconto)
		//console.log(resto)
		//console.log(abnt.arredonda(desconto - value))
	}

	async adicionarDesconto(descontoTDO: DescontoTDO) {


		const knex1 = await this.getConexaoCliente(descontoTDO.dados.contratoEmpresa)
		const empresa = await this.cripto.publicDecript(descontoTDO.dados.codigoEmpresa, "Success2021")
		const fornecedor = await this.cripto.publicDecript(descontoTDO.dados.fornecedor, "Success2021")
		const codigoCotacao = await this.cripto.publicDecript(descontoTDO.dados.codigo, "Success2021")


		const totalItens = await knex1.schema.raw(`select count(item6) as total from deic${empresa} where codigo6 = '${codigoCotacao}'  and forneced6 = '${fornecedor}';`);
		const ids = await knex1.schema.raw(`select item6 from deic${empresa} where codigo6 = '${codigoCotacao}'  and forneced6 = '${fornecedor}';`);
		// console.log(ids[0])

		const arrayGenerated: GeneratedData = await this.utilService.generateArrayOfValues(descontoTDO, totalItens);
		const arrayGeneratedDesconto = await this.utilService.generateArrayOfValuesDesconto(descontoTDO, totalItens);
		const arrayIdGenerated: GenerateIdDataByArray = await this.utilService.generateIdDataByArray(ids);

		// if (descontoTDO.tipo === 'P') {
		// 	totalParaCadaItem = valorAserDiminuido / totalItens[0][0].total;
		// } else {
		// 	totalParaCadaItem = descontoTDO.percentual / totalItens[0][0].total;
		// }

		//console.log(arrayGenerated)

		const frete = await knex1.schema.raw(
			`update deic${empresa} as itens set descot6 = ${arrayGeneratedDesconto.first},
			despesa6 = ${arrayGenerated.first},
			forpag6  = ${descontoTDO.formaPagamento}
				where codigo6 = '${codigoCotacao}'  and forneced6 = '${fornecedor}' and item6 != ${arrayIdGenerated.last}; `
		);

		const desconto = await knex1.schema.raw(
			`update deic${empresa} as itens set descot6 = ${arrayGeneratedDesconto.last},
			despesa6 = ${arrayGenerated.last},
			forpag6  = ${descontoTDO.formaPagamento}
				where codigo6 = '${codigoCotacao}'  and forneced6 = '${fornecedor}' and item6 = ${arrayIdGenerated.last}; `
		)
		console.log("=========")
		console.log(descontoTDO)
		console.log("=========")

		// return { statusCode: HttpStatus.CREATED, message: `201 Created`, success: true, totalCamposAtualizados: result[0].affectedRows }
		return { statusCode: HttpStatus.CREATED, message: `201 Created`, success: true }
	}

	ajustarDesconto() {

	}
}
