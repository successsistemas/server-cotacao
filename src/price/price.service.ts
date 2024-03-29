import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { restaurar } from 'src/common/cripto';
import { Empresa } from 'src/contrato/contrato';
import { CriptoService } from 'src/cripto/cripto.service';
import { getOrCreateKnexInstance } from 'src/database/knexCache';
import { SiteSuccessDatabaseService } from 'src/database/site-success-database.service';
import { CotacaoTDOPayload, Desconto, TotalFrete, TotalItens } from 'src/models/types';
const ABNT_5891_1977 = require('arredondamentoabnt').ABNT_5891_1977
const abnt = new ABNT_5891_1977(2);
@Injectable()
export class PriceService {
	constructor(private readonly siteSuccessDatabase: SiteSuccessDatabaseService,
		private readonly cripto: CriptoService,
	) { }

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


	async getItensCotacao(codCotacao: string, codFornecedor: string, contrato: string, codigoEmpresa: string) {

		const codigoCotacao = await this.cripto.publicDecript(codCotacao, "Success2021");
		const codigoFornecedor = await this.cripto.publicDecript(codFornecedor, "Success2021");
		const empresa = await this.cripto.publicDecript(codigoEmpresa, "Success2021");

		//const dadosEmpresa = await this.contratoService.getDadosConexao('1EDFFA7D75A6');

		const knex = await this.getConexaoCliente(contrato)
		try {
			// Aqui um exemplo de usar um objeto no select, acho que a sintaxe fica mais limpa
			const itensCotacao = knex('deic' + empresa)
				.leftJoin('dece' + empresa,
					(k) => k.on(`dece${empresa}.codigo6`, `deic${empresa}.codigo6`).andOn(`dece${empresa}.item6`, `deic${empresa}.item6`)
				)
				.where(`deic${empresa}.forneced6`, codigoFornecedor)
				.andWhere(`deic${empresa}.codigo6`, codigoCotacao)
				.select(
					{
						quantidade: `dece${empresa}.qtd6`,
						marca: `dece${empresa}.marca6`,
						descricao: `dece${empresa}.descricao6`,
						data: `deic${empresa}.data6`,
						codigo: `deic${empresa}.codigo6`,
						item: `deic${empresa}.item6`,
						produto: `deic${empresa}.produto6`,
						valordoproduto: `deic${empresa}.custo6`,
						frete: `deic${empresa}.despesa6`,
						st: `deic${empresa}.icmsst6`,
						icms: `deic${empresa}.icms6`,
						ipi: `deic${empresa}.ipi6`,
						mva: `deic${empresa}.mva6`,
						codbarras: `deic${empresa}.codfabric6`,
						formapagamento: `deic${empresa}.forpag6 `,
						desconto: `deic${empresa}.descot6`,
						observacao: `deic${empresa}.observac6`,
						prazo: `deic${empresa}.tempoent6`,
					}
				).orderBy("item", "asc")

			const valorTotalItens = await knex.select<TotalItens[]>(
				knex.raw("ifnull(sum(valordoproduto * quantidade), 0) as valorTotal")
			).from(itensCotacao)
				.joinRaw("as valorTotalItens")

			const totalFrete = await knex.select<TotalFrete[]>(
				knex.raw("ifnull(sum(frete), 0) as valorTotalFrete")
			).from(itensCotacao)
				.joinRaw("as valorTotalItens")


			const totalDesconto = await knex.select<Desconto[]>(
				knex.raw("ifnull(sum(desconto), 0) as valorTotalDesconto")
			).from(itensCotacao)
				.joinRaw("as valorTotalItens")

			const itensArray: any[] = await itensCotacao;
			//data, total, totalDesconto, frete
			return { itens: itensArray, totalDesconto: totalDesconto[0].valorTotalDesconto, frete: totalFrete[0].valorTotalFrete, total: valorTotalItens[0].valorTotal };
		} catch (err: any) {
			if (err?.errno === 1054) {
				throw new HttpException({ message: err?.sqlMessage }, HttpStatus.BAD_REQUEST);
			} else {
				throw new HttpException({ message: "Ocorreu um erro ao recuperar os items da cotação" }, HttpStatus.BAD_REQUEST);
			}

		}
	}

	async calcularFrete(cotacaoPayLoad: CotacaoTDOPayload) {

		const codigoCotacao = await this.cripto.publicDecript(cotacaoPayLoad.codigo, "Success2021");
		const codigoFornecedor = await this.cripto.publicDecript(cotacaoPayLoad.fornecedor, "Success2021");
		const empresa = await this.cripto.publicDecript(cotacaoPayLoad.codigoEmpresa, "Success2021");


		//const dadosEmpresa = await this.contratoService.getDadosConexao('1EDFFA7D75A6');

		const knex = await this.getConexaoCliente(cotacaoPayLoad.contratoEmpresa)



		const result = await knex.raw(
			`select ifnull(sum(despesa6), 0) as totalFrete  from dece${empresa} as dece,
			deic${empresa} as deic where dece.codigo6 = deic.codigo6 and dece.item6 = deic.item6 and
			dece.codigo6 = '${codigoCotacao}' and deic.forneced6 = '${codigoFornecedor}'; `
		);
		return result[0];

	}


	async calcularTotal(cotacaoPayLoad: CotacaoTDOPayload, buscarIds: boolean) {

		const codigoCotacao = await this.cripto.publicDecript(cotacaoPayLoad.codigo, "Success2021");
		const codigoFornecedor = await this.cripto.publicDecript(cotacaoPayLoad.fornecedor, "Success2021");
		const empresa = await this.cripto.publicDecript(cotacaoPayLoad.codigoEmpresa, "Success2021");

		//const dadosEmpresa = await this.contratoService.getDadosConexao('1EDFFA7D75A6');

		const knex = await this.getConexaoCliente(cotacaoPayLoad.contratoEmpresa)

		const result = await knex.raw(
			`select ifnull(sum(deic.custo6 * dece.qtd6 + ifnull(deic.despesa6, 0)), 0) as total  from dece${empresa} as dece,
			deic${empresa} as deic where dece.codigo6 = deic.codigo6 and dece.item6 = deic.item6 and
			dece.codigo6 = '${codigoCotacao}' and deic.forneced6 = '${codigoFornecedor}'; `
		);

		if (buscarIds) {
			const ids = await knex.raw(
				`select deic.item6  from dece${empresa} as dece,
			deic${empresa} as deic where dece.codigo6 = deic.codigo6 and dece.item6 = deic.item6 and
			dece.codigo6 = '${codigoCotacao}' and deic.forneced6 = '${codigoFornecedor}'; `
			);
			return [result[0][0], ids[0][0]];
		} else {
			return [result[0][0]];
		}
	}

	async calcularTotalDesconto(cotacaoPayLoad: CotacaoTDOPayload) {

		const codigoCotacao = await this.cripto.publicDecript(cotacaoPayLoad.codigo, "Success2021");
		const codigoFornecedor = await this.cripto.publicDecript(cotacaoPayLoad.fornecedor, "Success2021");
		const empresa = await this.cripto.publicDecript(cotacaoPayLoad.codigoEmpresa, "Success2021");

		//const dadosEmpresa = await this.contratoService.getDadosConexao('1EDFFA7D75A6');

		const knex = await this.getConexaoCliente(cotacaoPayLoad.contratoEmpresa)

		const result = await knex.raw(
			`select ifnull(sum(deic.descot6), 0) as totalDesconto  from dece${empresa} as dece,
			deic${empresa} as deic where dece.codigo6 = deic.codigo6 and dece.item6 = deic.item6 and
			dece.codigo6 = '${codigoCotacao}' and deic.forneced6 = '${codigoFornecedor}'; `
		);
		return result[0];
	}
}
