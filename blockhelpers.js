import { findVariables } from "./stringhelpers.js";
import { calculateStringValue } from "./stringhelpers.js";
import { 
    parenthesisRegex, 
    UUIDRegex, 
    bracketsRegex, 
    operatorRegex, 
    nameVariableRegex, 
    wordRegex, 
    pageRefRegex, 
    trigRegex 
} from "./regex.js";
import { unitCancel } from "./helpers.js";

//take raw content of block and convert into info for calcs
export async function parseBlockInfo(block) {
	console.log('begin parseBlockInfo');
	console.log(block);
	//if the block doesn't exist or has no content, stop
	if (block === undefined || block?.content === "") return false;

	let parsingBlock = block;
	//checks to see if the block is a block reference
	console.log(block.content);
	let isBlockRef = UUIDRegex.test(block.content);
	console.log(isBlockRef);

	//if block is a block reference, get the block and add to the calcTree
	if (isBlockRef) {
		let parsingUUID = block.content.slice(2,-2);
		let foreignBlock = await logseq.Editor.get_block(parsingUUID);
		parsingBlock = foreignBlock;
		console.log(foreignBlock);
		console.log("parseBlockInfo === foreign UUID updated")
	}

	let rawContent = parsingBlock.content ? parsingBlock.content : parsingBlock.rawContent
	//get only first line to avoid block parameters
	let firstLine = rawContent.split('\n')[0];
	let containsChildren = parsingBlock.children.length > 0;
	let childrenArray = [];

	//check to see if a variable has been declared
	let namesVariable = firstLine.includes(':=');
	let variableName = '';
	let rawVariableName = '';
	let rawVariableValue = firstLine;
	let toBeCalced = false;
	let variables = [];
	let containsVariables = false;

	//if it contains children, fill the array with their uuids
	if (containsChildren) {
		childrenArray = parsingBlock.children.map((item) => {
			return item[1];
		});
	}

	//if variable name has been declared, parse to determine name and value
	if (namesVariable) {
		let infoArray = firstLine.split(':=');
		//take the part of the string before the :=, and remove any [[]] from block references
		variableName = infoArray[0].replaceAll(bracketsRegex, '');
		rawVariableName = infoArray[0];
		rawVariableValue = infoArray[1];
	}

	//check if it needs to be calced based on containing an operator with a space on either side
	let containsOperator = operatorRegex.test(rawVariableValue);

	//remove named variables from the string before checking for words
	let namelessArray = rawVariableValue.replaceAll(nameVariableRegex, "")
	//remove existing results from string before checking for words
	let resultlessArray = namelessArray.split("=")[0];
	//split the string by spaces and see if any items start with a letter as a test for containing a word
	let wordArray = resultlessArray.split(" ");
	let containsWord = false;

	//check each item to see if it starts with a letter
	wordArray.every(item => {
		let isWord = wordRegex.test(item);
		let isPageRef = pageRefRegex.test(item);
		//check to see if word is a trig function
		let isTrig = trigRegex.test(item);
		if (isTrig) console.log(`${item} is a trig expression`);
		//if it's a word and not a trig function, return false
		if (isWord || isPageRef) {
			if (isWord) console.log(`${item} is a word!`);
			if (isPageRef) console.log(`${item} is a Page Ref!`);
			containsWord = true;
			return false
		}
		return true
	});

	//If it doesn't contain a word or it does contain ":=", check for variables
	if (!containsWord || namesVariable) {
		//check to see if other variables are included in expression
		variables = await findVariables(rawVariableValue);
		containsVariables = variables?.length !== 0;

		//if it contains variables OR it contains an operator, calculate variable
		if (containsVariables || containsOperator) {
			console.log("parseBlockInfo === Shalt be calced");
			toBeCalced = true;
		}
	}
	//if it doesn't contain a word and does contain an operator, calculate it
	if (!containsWord && containsOperator) toBeCalced = true;
	
	//always calculate blocks with a ":="
	if (namesVariable) toBeCalced = true;

	let parsedBlock = {
		uuid: parsingBlock.uuid,
		rawContent: rawContent.split('\n')[0],
		calculatedContent: '',
		value: false,
		valueStr: '',
		unit: '',
		containsChildren: containsChildren,
		children: childrenArray,
		rawVariableName: rawVariableName.trim(),
		variableName: variableName.trim(),
		rawCalcContent: rawVariableValue.trim(),
		toBeCalced: toBeCalced,
		isForeign: isBlockRef,
		hasBeenCalced: false,
		containsVariables: containsVariables,
		variables: variables,
	};

	console.log(parsedBlock);
	return parsedBlock;
}

//calculate value of given block content and return updated block
export function calculateBlockValue(block) {
	console.log('begin calculateBlockValue');

	let calcBlock = block;

	//only get the content to be calculated (before the = sign)
	let content = calcBlock.rawCalcContent.split('=')[0].trim();
	//calculate the value of the block
	let calcedString = calculateStringValue(content);

	//check if there's an error in the string calculation
	if (calcedString === false) {
		logseq.UI.showMsg(`error at "${content}"`, "error", {timeout: 20000});
		throw `error at ${content}`;
	}

	//parse calc results
	let {resultNum, unitsArray} = calcedString
	let resultStr = `${resultNum}`;

	//if the values had units, assume the last one is the resultant unit (for now)
	if (unitsArray.length > 0) {
		//if unit canceler is included, don't include unit in result
		let includesCanceler = unitsArray.includes(unitCancel);
		//remove parenthesis from units
		let resultUnit = includesCanceler ? "" : unitsArray[unitsArray.length - 1].replace(parenthesisRegex,"");
		resultStr = `${resultStr}${resultUnit}`;
		calcBlock.unit = resultUnit;
	}

	//only add := if a variable name is defined
	let calcedVariableName = '';
	if (calcBlock.rawVariableName.length > 0)
		calcedVariableName = `${calcBlock.rawVariableName} := `;

	//if there's no operator, don't add = results to the end of calculatedContent
	let displayedResults = ` = ${resultStr}`;
	let containsOperator = operatorRegex.test(content);
	if (!containsOperator) displayedResults = "";

	//update block info after calculation
	calcBlock.hasBeenCalced = true;
	calcBlock.value = resultNum;
	calcBlock.valueStr = resultStr;
	calcBlock.calculatedContent = `${calcedVariableName}${content}${displayedResults}`;

	return calcBlock;
}

//calculate block without variables
export async function calcBlock(rawBlock) {
	console.log('begin calcBlock');
	//get the current block
	let block = rawBlock;
	//parse it and prep info for calculation
	let parsedBlock = await parseBlockInfo(block);

	//if the block doesn't contain calcable content or is undefined, return false
	let calculateBlock = parsedBlock?.toBeCalced;
	if (!parsedBlock || !calculateBlock) {
		console.log('no items to calculate');
		return false;
	}
	//calculate block expression results and prep text display
	let calculatedBlock = calculateBlockValue(parsedBlock);
	console.log(calculatedBlock);

	return calculatedBlock;
}