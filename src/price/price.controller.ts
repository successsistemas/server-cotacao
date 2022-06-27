import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ClienteService } from 'src/cliente/cliente.service';
import { CotacaoService } from 'src/cotacao/cotacao.service';
import * as types from 'src/models/types';
import { CotacaoTDOPayload } from 'src/models/types';
import { PriceService } from './price.service';

@Controller('price')
export class PriceController {
	constructor(private clienteService: ClienteService, private cotacaoService: CotacaoService, private priceService: PriceService) { }


	@Get('findby/:codCotacao/:codFornecedor/:codContrato/:codEmpresa')
	async getAllItensFromCotacao(
		@Param('codCotacao') codCotacao: string, @Param('codFornecedor')
		codFornecedor: string, @Param('codEmpresa') codEmpresa: string, @Param('codContrato') codContrato: string) {

		const body: types.CotacaoTDOPayload = {
			codigo: codCotacao,
			fornecedor: codFornecedor,
			flag: '',
			contratoEmpresa: codContrato,
			codigoEmpresa: codEmpresa
		}



		// const total = await this.priceService.calcularTotal(body, false);
		// const frete = await this.priceService.calcularFrete(body);
		const { itens, totalDesconto, frete, total } = await this.priceService.getItensCotacao(codCotacao, codFornecedor, codContrato, codEmpresa);

		// const totalDesconto = await this.priceService.calcularTotalDesconto(body);

		const codigoCotacao = itens[0]?.codigo;
		const formaPagamento = itens[0]?.formapagamento;
		const dataTratado = itens;
		let isReady = true;
		for (let i = 0; i < dataTratado.length; i++) {
			//	console.log(dados.marca)
			if (dataTratado[i]?.valordoproduto === 0 || dataTratado[i]?.valordoproduto === null) {
				isReady = false;
				break;
			}
		}

		return {
			itens, total, totalDesconto, frete, isReady, codigoCotacao, formaPagamento
		}
		// return [
		// 	[data, total, totalDesconto, frete,
		// 	[{ "isReady": isReady }],
		// 	[{ "formaPagamento": data[0].formapagamento }],
		// 		[{ "numeroCotacao": data[0].codigo }]]
		// ];
	}
	@Post('update')
	async updateItemCotacao(@Body() body: types.ItemCotacaoTDO) {
		try {
			const result = await this.cotacaoService.updateItemCotacao(body);
			return result;
		} catch (e) {
			return { error: e }
		}

	}

	@Get('ready-to-send')
	async readToSend(@Body() body: CotacaoTDOPayload) {
		try {
			const result = await this.cotacaoService.isAllPreenchido(body);
			return result;
		} catch (e) {
			return { error: e }
		}
	}
}
