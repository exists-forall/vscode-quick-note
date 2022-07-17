import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { create } from 'domain';

type AbsolutePathResult =
	{ success: string } |
	{ error: "no-path" | "not-absolute" | "is-file" } |
	{ error: "not-found", dir: string };

function getAbsoluteNotesPath(dirConfig: string | undefined): AbsolutePathResult {
	if (dirConfig === undefined || dirConfig == "") {
		return { error: "no-path" };
	}
	// Check if path begins with a tilde
	if (dirConfig.startsWith("~")) {
		dirConfig = path.join(os.homedir(), dirConfig.substring(1));
	}
	// Check if path is absolute
	if (!path.isAbsolute(dirConfig)) {
		return { error: "not-absolute" };
	}
	// Check if path exists
	if (!fs.existsSync(dirConfig)) {
		return { error: "not-found", "dir": dirConfig };
	}
	// Check if path is a file
	if (!fs.statSync(dirConfig).isDirectory()) {
		return { error: "is-file" };
	}
	return { success: dirConfig };
}

function getDayDirectory(notesDir: string): string {
	// Get the current date and time in YYYY-MM-DD format
	const date = new Date();
	const dateString = date.toISOString().substring(0, 10);
	return path.join(notesDir, dateString);
}

function getNoteFileName(notesDir: string, fileExtension: string): string {
	// Ensure file extension starts with a dot
	if (!fileExtension.startsWith(".")) {
		fileExtension = "." + fileExtension;
	}
	// Get the current date and time in YYYY-MM-DDTHH-MM-SS format
	const date = new Date();
	const dateString = date.toISOString().replace(/:/g, "-").replace(/\.\d+Z/, "");
	return path.join(notesDir, `${dateString}${fileExtension}`);
}

async function createNote(languageId: string, fileExtension: string) {
	// Get the notes directory configured by the user in settings
	let dirConfig: string | undefined =
		vscode.workspace.getConfiguration('quick-note').get('notesDirectory');
	let absoluteDirConfig = getAbsoluteNotesPath(dirConfig);
	if ("error" in absoluteDirConfig) {
		if (absoluteDirConfig.error === "not-found") {
			const createAction = await vscode.window.showInformationMessage(`Notes directory \"${dirConfig}\" does not exist. Would you like to create it?`, "Create Directory");
			if (createAction === "Create Directory") {
				try {
					await vscode.workspace.fs.createDirectory(vscode.Uri.file(absoluteDirConfig.dir));
				} catch (e) {
					vscode.window.showErrorMessage(`Could not create notes directory "${dirConfig}".`);
					return;
				}
				absoluteDirConfig = { success: absoluteDirConfig.dir };
			} else {
				vscode.window.showErrorMessage("Could not create note.");
				return;
			}
		} else {
			let errorMessage: string;
			switch (absoluteDirConfig.error) {
				case "no-path":
					errorMessage = "No notes directory configured. Please configure it in settings.";
					break;
				case "not-absolute":
					errorMessage = `Notes directory "${dirConfig}" is not a valid absolute path. Please configure it in settings.`;
					break;
				case "is-file":
					errorMessage = `Notes directory "${dirConfig}" is not a directory. Please configure it in settings.`;
					break;
			}
			const configureAction = await vscode.window.showErrorMessage(errorMessage, "Configure");
			if (configureAction === "Configure") {
				await vscode.commands.executeCommand("workbench.action.openSettings", "quick-note");
			}
			return;
		}
	}
	// Get the directory for the current day
	const dayDir = getDayDirectory(absoluteDirConfig.success);
	// Create the directory if it doesn't exist
	try {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(dayDir));
	} catch (e) {
		vscode.window.showErrorMessage(`Could not create notes directory "${dayDir}". Please check if the root notes directory is writable.`);
	}
	// Get the note file name
	const noteFileName = getNoteFileName(dayDir, fileExtension);
	// Construct a workspace edit to create the note file and open it
	const edit = new vscode.WorkspaceEdit();
	edit.createFile(vscode.Uri.file(noteFileName), { overwrite: false });
	try {
		await vscode.workspace.applyEdit(edit);
	} catch (e) {
		vscode.window.showErrorMessage(`Could not create note file "${noteFileName}". Please check if the notes directory is writable.`);
		return;
	}
	// Open the note file
	const doc = await vscode.window.showTextDocument(vscode.Uri.file(noteFileName));
	// Set the language of the note file
	vscode.languages.setTextDocumentLanguage(doc.document, languageId);
}

type LanguageInfo = {
	name: string;
	extension: string;
};

function getAllLanguageInfo(): Map<string, LanguageInfo> {
	const result = new Map<string, LanguageInfo>();
	result.set("plaintext", { name: "Plain Text", extension: ".txt" });
	for (const extension of vscode.extensions.all) {
		const contributes = extension.packageJSON.contributes;
		if (contributes instanceof Object && Array.isArray(contributes.languages)) {
			for (const language of contributes.languages) {
				if (!(
					language instanceof Object &&
					typeof language.id === "string" &&
					!result.has(language.id) &&
					Array.isArray(language.aliases) &&
					language.aliases.length > 0 &&
					Array.isArray(language.extensions) &&
					language.extensions.length > 0
				)) {
					continue;
				}
				result.set(language.id, {
					name: language.aliases[0],
					extension: language.extensions[0],
				});
			}
		}
	}
	return result;
}

export function activate(context: vscode.ExtensionContext) {
	let disposable: vscode.Disposable;

	disposable = vscode.commands.registerCommand('quick-note.newNote', async () => {
		await createNote("plaintext", ".txt");
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('quick-note.newNoteWithLanguage', async () => {
		// Get name and extension info for all languages
		const languageInfo = getAllLanguageInfo();
		// Create a quick pick list of all languages
		const languagePicks = [];
		for (const [id, info] of languageInfo) {
			languagePicks.push({ label: info.name, description: `(${id})`, id });
		}
		// Show the quick pick list
		const languagePick = await vscode.window.showQuickPick(languagePicks, {
			title: "New Note with Language",
			placeHolder: "Select a language",
		});
		if (languagePick === undefined) {
			return;
		}
		const languageId = languagePick.id;
		await createNote(languageId, languageInfo.get(languageId)!.extension);
	});
	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
